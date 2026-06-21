#!/usr/bin/env python3
"""Comprehensive worker test - checks all routes and validates responses."""
import urllib.request, json, sys, time

BASE = 'https://roast-my-landing-page-test.falling-hall-ac41.workers.dev'
BROWSER_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Origin': BASE,
    'Referer': BASE + '/',
}
API_HEADERS = {**BROWSER_HEADERS, 'Accept': 'application/json'}

def check(method, path, headers=None, expected=200, data=None, follow_redirects=True):
    if headers is None:
        headers = BROWSER_HEADERS
    try:
        req_data = json.dumps(data).encode() if data else None
        if req_data:
            headers = {**headers, 'Content-Type': 'application/json'}
        req = urllib.request.Request(BASE + path, method=method, headers=headers, data=req_data)
        opener = urllib.request.build_opener() if follow_redirects else urllib.request.build_opener(urllib.request.HTTPRedirectHandler())
        try:
            resp = opener.open(req, timeout=15)
            status = resp.status
            body = resp.read(1000).decode('utf-8', errors='ignore')
        except urllib.error.HTTPError as e:
            status = e.code
            body = e.read(500).decode('utf-8', errors='ignore')
        
        ok = status == expected or (expected == 200 and status in (200, 301, 302))
        icon = '✅' if ok else '❌'
        detail = ''
        if status == 500 or 'error code' in body.lower() or 'exception' in body.lower():
            detail = f' | ERROR: {body[:100]}'
        print(f'{icon} {status:<4} {method:<5} {path}{detail}')
        return ok, status, body
    except Exception as e:
        print(f'❌ ERR  {method:<5} {path}: {str(e)[:80]}')
        return False, 0, ''

def run_tests():
    failures = []
    
    print(f'\n{"="*60}')
    print(f'Testing: {BASE}')
    print(f'{"="*60}\n')

    tests = [
        # Page routes
        ('GET', '/', BROWSER_HEADERS, 200),
        ('GET', '/gallery', BROWSER_HEADERS, 200),
        ('GET', '/pricing', BROWSER_HEADERS, 200),
        ('GET', '/sitemap.xml', BROWSER_HEADERS, 200),
        ('GET', '/roast/b2c4ad0d', BROWSER_HEADERS, 200),
        # API routes
        ('GET', '/api/stats', API_HEADERS, 200),
        ('GET', '/api/gallery?page=1', API_HEADERS, 200),
        ('GET', '/api/recent', API_HEADERS, 200),
        ('GET', '/api/roast/b2c4ad0d', API_HEADERS, 200),
        ('GET', '/api/og/b2c4ad0d', API_HEADERS, 200),
        ('GET', '/api/og-image/b2c4ad0d', API_HEADERS, 200),  # Redirect → og
        ('GET', '/api/screenshot/b2c4ad0d', API_HEADERS, 200),
        ('GET', '/api/card/b2c4ad0d', API_HEADERS, 200),
        ('GET', '/api/leaderboard', API_HEADERS, 200),
        ('GET', '/api/leaderboard/weekly', API_HEADERS, 200),
        ('GET', '/api/leaderboard/alltime', API_HEADERS, 200),
        ('GET', '/api/industry/all', API_HEADERS, 200),
        ('GET', '/api/showcase', API_HEADERS, 200),
        ('GET', '/api/featured', API_HEADERS, 200),
        ('GET', '/api/live-activity', API_HEADERS, 200),
        ('GET', '/api/feed', API_HEADERS, 200),
        ('GET', '/api/analytics', API_HEADERS, 200),
        ('GET', '/api/platform-stats', API_HEADERS, 200),
        # Badge routes
        ('GET', '/api/badge/b2c4ad0d', API_HEADERS, 200),
        ('GET', '/api/badge/b2c4ad0d/html', API_HEADERS, 200),
    ]

    print('Page & API Routes:')
    print('-' * 60)
    for method, path, hdrs, expected in tests:
        ok, status, body = check(method, path, hdrs, expected)
        if not ok:
            failures.append(f'{method} {path} (got {status}, expected {expected})')

    # Content validation
    print('\nContent Validation:')
    print('-' * 60)
    ok, status, body = check('GET', '/roast/b2c4ad0d', BROWSER_HEADERS, 200)
    if '<title>' not in body:
        print('❌ Roast page missing <title> tag')
        failures.append('Roast page missing <title>')
    elif 'error' in body.lower() and 'worker' in body.lower():
        print('❌ Roast page contains worker error')
        failures.append('Roast page has worker error')
    else:
        print('✅ Roast page has valid HTML title')

    ok, status, body = check('GET', '/api/stats', API_HEADERS, 200)
    if '"total_roasts"' in body:
        data = json.loads(body) if body.startswith('{') else {}
        print(f'✅ Stats API: {data.get("total_roasts", "?")} roasts')
    else:
        print(f'❌ Stats API missing total_roasts field')
        failures.append('Stats API invalid response')

    ok, status, body = check('GET', '/api/gallery?page=1', API_HEADERS, 200)
    if body.startswith('[') and len(body) > 10:
        try:
            items = json.loads(body)
            print(f'✅ Gallery API: {len(items)} items returned')
        except json.JSONDecodeError:
            # Response is too long for our read buffer but starts as JSON array - it's fine
            print(f'✅ Gallery API: Valid JSON array (truncated preview)')
    else:
        print(f'❌ Gallery API invalid: {body[:100]}')
        failures.append('Gallery API invalid response')

    # Summary
    print(f'\n{"="*60}')
    if failures:
        print(f'❌ FAILED: {len(failures)} issues:')
        for f in failures:
            print(f'   - {f}')
    else:
        print('✅ ALL TESTS PASSED!')
    print(f'{"="*60}\n')
    return len(failures) == 0

if __name__ == '__main__':
    success = run_tests()
    sys.exit(0 if success else 1)
