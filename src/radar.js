import { CONFIG } from './config.js';
import { hashUrl, fetchWithTimeout } from './utils.js';

async function getRadarDomainRanking(domain22, apiToken) {
  try {
    const headers = {
      "Content-Type": "application/json"
    };
    if (apiToken) {
      headers["Authorization"] = `Bearer ${apiToken}`;
    }
    const response = await fetchWithTimeout(
      `https://api.cloudflare.com/client/v4/radar/ranking/domain/${encodeURIComponent(domain22)}`,
      { headers, timeout: CONFIG.RADAR_TIMEOUT_MS }
    );
    if (!response.ok) {
      console.error(`Radar ranking API error: ${response.status}`);
      return { rank: null, bucket: null, categories: [], popularityLabel: "Not available" };
    }
    const data = await response.json();
    if (!data.success || !data.result?.details_0) {
      return { rank: null, bucket: null, categories: [], popularityLabel: "Unknown" };
    }
    const details = data.result.details_0;
    const bucket = details.bucket;
    const rank = details.rank;
    let popularityLabel = "Unknown";
    if (bucket) {
      const bucketNum = parseInt(bucket);
      if (rank && rank <= 100) {
        popularityLabel = `Top ${rank} globally`;
      } else if (bucketNum <= 200) {
        popularityLabel = "Top 200 (Extremely Popular)";
      } else if (bucketNum <= 500) {
        popularityLabel = "Top 500 (Very Popular)";
      } else if (bucketNum <= 1e3) {
        popularityLabel = "Top 1K (Highly Popular)";
      } else if (bucketNum <= 5e3) {
        popularityLabel = "Top 5K (Popular)";
      } else if (bucketNum <= 1e4) {
        popularityLabel = "Top 10K (Well Known)";
      } else if (bucketNum <= 5e4) {
        popularityLabel = "Top 50K (Established)";
      } else if (bucketNum <= 1e5) {
        popularityLabel = "Top 100K (Growing)";
      } else if (bucketNum <= 5e5) {
        popularityLabel = "Top 500K (Emerging)";
      } else if (bucketNum <= 1e6) {
        popularityLabel = "Top 1M (Niche)";
      } else {
        popularityLabel = "Beyond Top 1M";
      }
    }
    return {
      rank: rank || null,
      bucket: bucket || null,
      categories: details.categories || [],
      popularityLabel
    };
  } catch (error32) {
    console.error("Radar ranking fetch error:", error32);
    return { rank: null, bucket: null, categories: [], popularityLabel: "Unknown" };
  }
}
async function getRadarGeoDistribution(domain22, apiToken) {
  try {
    const headers = {
      "Content-Type": "application/json"
    };
    if (apiToken) {
      headers["Authorization"] = `Bearer ${apiToken}`;
    }
    const response = await fetchWithTimeout(
      `https://api.cloudflare.com/client/v4/radar/dns/top/locations?domain=${encodeURIComponent(domain22)}&limit=5&dateRange=7d`,
      { headers, timeout: CONFIG.RADAR_TIMEOUT_MS }
    );
    if (!response.ok) {
      console.error(`Radar geo API error: ${response.status}`);
      return [];
    }
    const data = await response.json();
    if (!data.success || !data.result?.top_0) {
      return [];
    }
    return data.result.top_0.map((loc) => ({
      country: loc.clientCountryAlpha2,
      countryName: loc.clientCountryName,
      percentage: parseFloat(loc.value)
    }));
  } catch (error32) {
    console.error("Radar geo fetch error:", error32);
    return [];
  }
}
async function getRadarInsights(url, apiToken) {
  try {
    const domain22 = new URL(url).hostname.replace(/^www\./, "");
    const [ranking, geoDistribution] = await Promise.all([
      getRadarDomainRanking(domain22, apiToken),
      getRadarGeoDistribution(domain22, apiToken)
    ]);
    return { ranking, geoDistribution };
  } catch (error32) {
    console.error("Radar insights error:", error32);
    return {
      ranking: { rank: null, bucket: null, categories: [], popularityLabel: "Unknown" },
      geoDistribution: [],
      error: "Failed to fetch Radar insights"
    };
  }
}
async function queryCloudflareGraphQL(query, variables, apiToken) {
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ query, variables })
    });
    if (!response.ok) {
      console.error(`GraphQL API error: ${response.status}`);
      return null;
    }
    const data = await response.json();
    if (data.errors) {
      console.error("GraphQL errors:", data.errors);
      return null;
    }
    return data.data;
  } catch (error32) {
    console.error("GraphQL query error:", error32);
    return null;
  }
}

export { getRadarDomainRanking, getRadarGeoDistribution, getRadarInsights, queryCloudflareGraphQL };
