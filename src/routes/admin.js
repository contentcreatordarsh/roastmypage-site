import { queryCloudflareGraphQL } from '../radar.js';
import { getTimeAgo } from '../utils.js';

export async function handleAdminRoutes(request, env22, _ctx, { url, corsHeaders }) {
    if (url.pathname === "/api/analytics" && request.method === "GET") {
      try {
        const scoreDistribution = await env22.DB.prepare(`
          SELECT 
            CASE 
              WHEN overall_score >= 9 THEN '9-10'
              WHEN overall_score >= 7 THEN '7-8'
              WHEN overall_score >= 5 THEN '5-6'
              WHEN overall_score >= 3 THEN '3-4'
              ELSE '1-2'
            END as range,
            COUNT(*) as count
          FROM roasts
          GROUP BY range
          ORDER BY range DESC
        `).all();
        const categoryAverages = await env22.DB.prepare(`
          SELECT 
            ROUND(AVG(hero_score), 1) as hero,
            ROUND(AVG(cta_score), 1) as cta,
            ROUND(AVG(trust_score), 1) as trust,
            ROUND(AVG(copy_score), 1) as copy,
            ROUND(AVG(design_score), 1) as design
          FROM roasts
        `).first();
        const topDomains = await env22.DB.prepare(`
          SELECT 
            url,
            COUNT(*) as roast_count,
            ROUND(AVG(overall_score), 1) as avg_score,
            MAX(overall_score) as best_score
          FROM roasts
          GROUP BY url
          ORDER BY roast_count DESC
          LIMIT 10
        `).all();
        const recentActivity = await env22.DB.prepare(`
          SELECT id, url, overall_score, created_at
          FROM roasts
          ORDER BY created_at DESC
          LIMIT 10
        `).all();
        const dailyRoasts = await env22.DB.prepare(`
          SELECT 
            DATE(created_at) as date,
            COUNT(*) as count,
            ROUND(AVG(overall_score), 1) as avg_score
          FROM roasts
          WHERE created_at > datetime('now', '-7 days')
          GROUP BY DATE(created_at)
          ORDER BY date ASC
        `).all();
        const overallStats = await env22.DB.prepare(`
          SELECT 
            COUNT(*) as total_roasts,
            ROUND(AVG(overall_score), 1) as avg_score,
            MAX(overall_score) as highest_score,
            MIN(overall_score) as lowest_score,
            COUNT(DISTINCT url) as unique_urls
          FROM roasts
        `).first();
        const bestPage = await env22.DB.prepare(`
          SELECT url, overall_score FROM roasts ORDER BY overall_score DESC LIMIT 1
        `).first();
        const worstPage = await env22.DB.prepare(`
          SELECT url, overall_score FROM roasts ORDER BY overall_score ASC LIMIT 1
        `).first();
        const formattedDomains = topDomains.results.map((d) => {
          try {
            return { ...d, hostname: new URL(d.url).hostname };
          } catch {
            return { ...d, hostname: d.url };
          }
        });
        const formattedActivity = recentActivity.results.map((r) => {
          try {
            const hostname = new URL(r.url).hostname;
            const timeAgo = getTimeAgo(/* @__PURE__ */ new Date(r.created_at + "Z"));
            return { ...r, hostname, timeAgo };
          } catch {
            return { ...r, hostname: r.url, timeAgo: "recently" };
          }
        });
        return Response.json({
          scoreDistribution: scoreDistribution.results,
          categoryAverages,
          topDomains: formattedDomains,
          recentActivity: formattedActivity,
          dailyRoasts: dailyRoasts.results,
          overallStats,
          highlights: {
            bestPage: bestPage ? { hostname: new URL(bestPage.url).hostname, score: bestPage.overall_score } : null,
            worstPage: worstPage ? { hostname: new URL(worstPage.url).hostname, score: worstPage.overall_score } : null
          }
        }, { headers: corsHeaders });
      } catch (error32) {
        console.error("Analytics error:", error32);
        return Response.json({ error: "Failed to load analytics" }, { status: 500, headers: corsHeaders });
      }
    }
    if (url.pathname === "/api/platform-stats" && request.method === "GET") {
      try {
        // Removed early return to allow D1 stats to load even if CF API token is missing
        const cacheKey = "platform-stats";
        const cached = await env22.CONFIG.get(cacheKey);
        if (cached) {
          return Response.json(JSON.parse(cached), { headers: corsHeaders });
        }
        const now = /* @__PURE__ */ new Date();
        const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1e3);
        const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1e3);
        const endTime = now.toISOString();
        const startTime24h = yesterday.toISOString();
        const startTime48h = twoDaysAgo.toISOString();
        const cdnQuery = `
          query CDNRequests($zoneTag: string, $start: Time, $end: Time) {
            viewer {
              zones(filter: {zoneTag: $zoneTag}) {
                httpRequestsAdaptiveGroups(
                  filter: {
                    datetime_geq: $start,
                    datetime_lt: $end
                  }
                  limit: 1
                ) {
                  sum {
                    requests
                  }
                }
              }
            }
          }
        `;
        const workerQuery = `
          query WorkerInvocations($accountTag: string, $start: Time, $end: Time) {
            viewer {
              accounts(filter: {accountTag: $accountTag}) {
                workersInvocationsAdaptive(
                  filter: {
                    datetime_geq: $start,
                    datetime_lt: $end
                  }
                  limit: 1
                ) {
                  sum {
                    requests
                  }
                }
              }
            }
          }
        `;
        let cdnCurrent = null, cdnPrevious = null, workerCurrent = null, workerPrevious = null;
        if (env22.ANALYTICS_API_TOKEN) {
          try {
            [cdnCurrent, cdnPrevious, workerCurrent, workerPrevious] = await Promise.all([
              queryCloudflareGraphQL(cdnQuery, {
                zoneTag: env22.CF_ZONE_TAG || "",
                start: startTime24h,
                end: endTime
              }, env22.ANALYTICS_API_TOKEN),
              queryCloudflareGraphQL(cdnQuery, {
                zoneTag: env22.CF_ZONE_TAG || "",
                start: startTime48h,
                end: startTime24h
              }, env22.ANALYTICS_API_TOKEN),
              queryCloudflareGraphQL(workerQuery, {
                accountTag: env22.CF_ACCOUNT_TAG || "",
                start: startTime24h,
                end: endTime
              }, env22.ANALYTICS_API_TOKEN),
              queryCloudflareGraphQL(workerQuery, {
                accountTag: env22.CF_ACCOUNT_TAG || "",
                start: startTime48h,
                end: startTime24h
              }, env22.ANALYTICS_API_TOKEN)
            ]);
          } catch(e) { console.error('CF GraphQL Error', e); }
        }
        const cdnRequests24h = cdnCurrent?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups?.[0]?.sum?.requests || 0;
        const cdnRequestsPrevious = cdnPrevious?.viewer?.zones?.[0]?.httpRequestsAdaptiveGroups?.[0]?.sum?.requests || 0;
        const workerCalls24h = workerCurrent?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]?.sum?.requests || 0;
        const workerCallsPrevious = workerPrevious?.viewer?.accounts?.[0]?.workersInvocationsAdaptive?.[0]?.sum?.requests || 0;
        const cdnGrowth = cdnRequestsPrevious > 0 ? Math.round((cdnRequests24h - cdnRequestsPrevious) / cdnRequestsPrevious * 100) : 0;
        const workerGrowth = workerCallsPrevious > 0 ? Math.round((workerCalls24h - workerCallsPrevious) / workerCallsPrevious * 100) : 0;
        const roastStats = await env22.DB.prepare(`
          SELECT 
            COUNT(*) as total_roasts,
            COUNT(*) FILTER (WHERE created_at > datetime('now', '-1 day')) as roasts_24h,
            COUNT(*) FILTER (WHERE created_at > datetime('now', '-2 days') AND created_at <= datetime('now', '-1 day')) as roasts_previous_24h
          FROM roasts
        `).first();
        const roastsGrowth = roastStats && roastStats.roasts_previous_24h > 0 ? Math.round((roastStats.roasts_24h - roastStats.roasts_previous_24h) / roastStats.roasts_previous_24h * 100) : 0;
        const screenshotsStored = roastStats?.total_roasts || 0;
        const countryStats = await env22.DB.prepare(`
          SELECT COUNT(DISTINCT country) as country_count
          FROM roasts
          WHERE country IS NOT NULL AND country != ''
        `).first();
        const hourlyDistribution = await env22.DB.prepare(`
          SELECT 
            CAST(strftime('%H', created_at) AS INTEGER) as hour,
            COUNT(*) as count
          FROM roasts
          WHERE created_at > datetime('now', '-7 days')
          GROUP BY hour
          ORDER BY hour
        `).all();
        const hourlyData = hourlyDistribution.results;
        const peakHour = hourlyData.reduce((max, curr) => curr.count > max.count ? curr : max, { hour: 0, count: 0 });
        const topCountries = await env22.DB.prepare(`
          SELECT 
            country,
            COUNT(*) as count
          FROM roasts
          WHERE created_at > datetime('now', '-30 days')
            AND country IS NOT NULL 
            AND country != ''
          GROUP BY country
          ORDER BY count DESC
          LIMIT 10
        `).all();
        const industryDistribution = await env22.DB.prepare(`
          SELECT 
            industry,
            COUNT(*) as count
          FROM roasts
          WHERE industry IS NOT NULL AND industry != ''
          GROUP BY industry
          ORDER BY count DESC
          LIMIT 5
        `).all();
        const avgResponseTime = await env22.DB.prepare(`
          SELECT 
            AVG(JULIANDAY(created_at) - JULIANDAY(created_at)) * 24 * 60 * 60 as avg_seconds
          FROM roasts
          WHERE created_at > datetime('now', '-7 days')
        `).first();
        const result = {
          cdnRequests24h,
          workerCalls24h,
          roastsCompleted: roastStats?.roasts_24h || 0,
          screenshotsStored,
          countriesReached: countryStats?.country_count || 0,
          growth: {
            cdn: cdnGrowth,
            workers: workerGrowth,
            roasts: roastsGrowth
          },
          peakUsage: {
            peakHour: peakHour.hour,
            peakHourLabel: `${peakHour.hour}:00 - ${peakHour.hour + 1}:00 UTC`,
            peakHourCount: peakHour.count,
            hourlyDistribution: hourlyData
          },
          topCountries: topCountries.results.map((c) => ({
            country: c.country,
            count: c.count,
            percentage: roastStats?.total_roasts ? Math.round(c.count / roastStats.total_roasts * 100) : 0
          })),
          topIndustries: industryDistribution.results.map((i) => ({
            industry: i.industry,
            count: i.count,
            percentage: roastStats?.total_roasts ? Math.round(i.count / roastStats.total_roasts * 100) : 0
          })),
          performance: {
            avgResponseTimeSeconds: Math.round(avgResponseTime?.avg_seconds || 0)
          },
          timestamp: now.toISOString()
        };
        await env22.CONFIG.put(cacheKey, JSON.stringify(result), { expirationTtl: 300 });
        return Response.json(result, { headers: corsHeaders });
      } catch (error32) {
        console.error("Platform stats error:", error32);
        return Response.json({
          error: "Failed to load platform stats",
          cdnRequests24h: 0,
          workerCalls24h: 0,
          roastsCompleted: 0,
          screenshotsStored: 0,
          countriesReached: 0,
          growth: { cdn: 0, workers: 0, roasts: 0 }
        }, { status: 500, headers: corsHeaders });
      }
    }
  return null;
}
