const https = require('https');
const http = require('http');
const util = require('node:util');
const debuglog = util.debuglog('log');

/* NOTE: to avoid confusion between an URL and a href, 
I'll consider them based on how Node.js considers them.
So, an URL is an object containing different properties (href, hostname, tags, etc.),
while a href is a string representing an address (e.g. 'http://example.org') */

/* Given the Event-Driven model of http requests,
I do not know how to determine a "good" number of concurrent checks. */
const MAX_CONCURRENT_EXTERNAL = 20;
const MAX_CONCURRENT_INTERNAL = 10;
const MAX_CRAWLING_DEPTH = 5;
const MAX_PAGES = 1000;
// ==> max pending requests = MAX_CONCURRENT_INTERNAL * MAX_CONCURRENT_EXTERNAL

const ORIGIN_HREF = process.argv[2];

main();

async function main() 
{
    let tot_time = Date.now();

    let origin_url = null;
    try {
        origin_url = new URL(ORIGIN_HREF);
    } catch (error) {
        console.error(`[ERROR]: '${ORIGIN_HREF}' is not a valid URL.`);
        return;
    }

    const internal_visited = new Set();
    const external_visited = new Set();
    const crawling_data = {
        pages_crawled: 0,
        external_hrefs_checked: 0
    };

    console.log(`Starting crawling at '${ORIGIN_HREF}'.`);

    await crawl_site(origin_url, internal_visited, external_visited, crawling_data);

    console.log(`[INFO]: Pages crawled: ${crawling_data.pages_crawled}`);
    console.log(`[INFO]: External hrefs checked: ${crawling_data.external_hrefs_checked}`);
    console.log(`[INFO]: Crawling duration: ${((Date.now() - tot_time) / 1000).toFixed(2)}s`);
}

async function crawl_site(origin_url, internal_visited, external_visited, crawling_data)
{
    const queue = [{
        url: origin_url,
        parent: null,
        depth: 0
    }];

    internal_visited.add(origin_url);
    
    while (queue.length > 0 && crawling_data.pages_crawled < MAX_PAGES) 
    {
        const batch = queue.splice(0, Math.min(MAX_CONCURRENT_INTERNAL, queue.length, MAX_PAGES - crawling_data.pages_crawled));    
        const batch_promises = batch.map(item => crawl_page(item, queue, internal_visited, external_visited, crawling_data));
        
        await Promise.all(batch_promises);
    }
    
    if (crawling_data.pages_crawled >= MAX_PAGES) {
        console.log(`[INFO]: Reached maximum page limit (${MAX_PAGES}). Stopping crawler.`);
    }
}

async function crawl_page(item, queue, internal_visited, external_visited, crawling_data)
{
    const { url, parent, depth } = item;
    
    if (depth > MAX_CRAWLING_DEPTH) {
        return;
    }
    
    const { HTML_page, msg } = await fetch_HTML_page(url);
    
    if (!HTML_page && msg) {
        console.error(`[ERROR] at page '${parent}' for href '${url.href}'. Message: ${msg}.`);
        return;
    } else if (!HTML_page && !msg) {
        debuglog(`At page '${parent}' for href '${url.href}'. The resource was successfully fetched, but it is not a HTML page.`);
        return;
    }

    crawling_data.pages_crawled += 1;
    
    const hrefs = collect_hrefs(HTML_page);
    const { internal_hrefs, external_hrefs } = categorize_hrefs(hrefs, url);
    // console.log(item);
    debuglog(`'${url.href}': Found ${internal_hrefs.length} internal and ${external_hrefs.length} external hrefs.`);

    // Process external links
    await check_external_links(external_hrefs, url.href, external_visited, crawling_data);
    
    // Add internal links to the queue with increased depth
    for (const href of internal_hrefs) {
        try {
            // Resolve a relative URL to the absolute one
            let abs_url = new URL(href, url.href);
            if (!internal_visited.has(abs_url.href)) {
                queue.push({ 
                    url: abs_url,
                    parent: url.href,
                    depth: depth + 1
                });
                internal_visited.add(abs_url.href);
            }
        } catch (error) {
            console.error(`[ERROR] '${url.href}': the href '${href}' is not valid. Message: ${error}.`);
        }
    }
}

async function check_external_links(external_hrefs, page_href, external_visited, crawling_data)
{
    debuglog('\tVisiting Externals:');
    const unchecked_external_hrefs = external_hrefs.filter(href => !external_visited.has(href));
    unchecked_external_hrefs.forEach(href => external_visited.add(href));
    
    for (let i = 0; i < unchecked_external_hrefs.length; i += MAX_CONCURRENT_EXTERNAL) 
    {
        const batch = unchecked_external_hrefs.slice(i, i + MAX_CONCURRENT_EXTERNAL);
        const batch_promises = batch.map(href => {
            debuglog(`\t- ${href}`);
            return (async () => {
                try {
                    const url = new URL(href);
                    const { is_href_valid, msg } = await check_href_validity(url);
                    if (!is_href_valid) {
                        console.warn(`[WARN]: Bad response for '${href}' contained in '${page_href}'. Message: ${msg}.`);
                    }
                } catch (error) {
                    console.error(`[ERROR] at page '${page_href}' for href '${href}'. Message: ${error.message}.`);
                }
            })();
        });
    
        await Promise.all(batch_promises);
    }
    
    crawling_data.external_hrefs_checked += unchecked_external_hrefs.length;
}

/**
 * Check if a href is valid by making a HEAD request with the corresponding URL
 * @param {URL} url 
 * @returns {Promise<boolean>}
 */
function check_href_validity(url) {
    return new Promise((resolve) => 
    {
        const options = {
            method: 'HEAD', // I just have to verify the validity
            timeout: 2000,
        };
        
        const module_to_use = url.protocol.split(':')[0] === 'http' ? http : https;
        const req = module_to_use.request(url, options);
        req.end();

        let is_href_valid = false;
        let msg = null;

        let f_event_handled = false;   

        req.on('response', (res) => {
            if (f_event_handled) return;
            f_event_handled = true;
            
            res.setEncoding('utf8');
            
            let chunks = [];
            res.on('data', chunk => {
                chunks.push(chunk);
            });
            
            res.on('end', () => {
                /* Sometimes I get a 404, but the page actually exists. 
                And I get the same result by opening the link in the browser.
                So, I guess there is something misconfigured in their server. */
                if (res.statusCode === 404 || res.statusCode === 410 || (res.statusCode >= 500 && res.statusCode <= 599)) {
                    msg = `${res.statusCode}: ${res.statusMessage}`;
                } else {
                    /* 
                    - X sends back a 403 in case of a HEAD request.
                    - LinkedIn sends back a 999 because of the User-Agent. 
                    So, even though they may seem bad responses, they are actually expected.
                    So, I consider bad just the ones listed above. */
                    is_href_valid = true;
                }
            });
        });
        
        req.on('timeout', () => {
            if (f_event_handled) return;
            f_event_handled = true;
            msg = 'timeout';
            req.destroy();
        });
        
        req.on('error', (err) => {
            if (f_event_handled) return;
            f_event_handled = true;
            msg = err.message;
        });

        req.on('close', () => {
            req.destroy();
            resolve({ is_href_valid, msg });
        });
    });
}

/**
 * @param {URL} url 
 * @returns Promise<{HTML_page: string, url: URL}>
 */
function fetch_HTML_page(url) 
{
    return new Promise((resolve, reject) => 
    {
        let options = {
            method: 'GET',
            timeout: 2000,
        };

        const module_to_use = url.protocol.split(':')[0] === 'http' ? http : https;
        let req = module_to_use.request(url, options);
        req.end();
        
        let HTML_page = null;
        let msg = null;
        
        let f_event_handled = false;    
        
        req.on('response', res => {
            if (f_event_handled) return;
            f_event_handled = true;

            res.setEncoding('utf8');
            
            let chunks = [];
            res.on('data', chunk => {
                chunks.push(chunk);
            });
        
            res.on('end', () => {
                if (res.statusCode === 404 || res.statusCode === 410 || (res.statusCode >= 500 && res.statusCode <= 599)) {
                    msg = `${res.statusCode}: ${res.statusMessage}`;
                }
                else if (res.headers['content-type']?.includes('text/html')) {
                    HTML_page = chunks.join('');
                }
            });
        });
        
        req.on('timeout', () => {
            if (f_event_handled) return;
            f_event_handled = true;
            msg = 'timeout';
            req.destroy();
        });
        
        req.on('error', (err) => {
            if (f_event_handled) return;
            f_event_handled = true;
            msg = err.message;
        });
        
        req.on('close', () => {
            req.destroy();
            resolve({ HTML_page, msg });
        });
    });
}

/**
 * It collects the hrefs from the anchor tags (<a>) of the HTML page
 * @param {string} HTML_page
 * @returns {string[]} hrefs
 */
function collect_hrefs(HTML_page) 
{
    const href_regex = /<a\s+[^>]*?\s*href\s*=\s*(['"])(.*?)\1[^>]*?>/gi;
    const hrefs = [];

    let match;
    while (match = href_regex.exec(HTML_page)) {
        hrefs.push(match[2].trim());
    }
    
    return hrefs;
}

/**
 * Categorize an array of hrefs into internal and external ones
 * @param {string[]} hrefs - Array of hrefs to categorize
 * @param {URL} url - The URL object of the page being crawled
 * @returns {Object} - Object containing internal_links and external_links arrays
 */
function categorize_hrefs(hrefs, url) 
{
    const internal_hrefs = [];
    const external_hrefs = [];
    
    hrefs.forEach(href => 
    {
        if (!href) return;

        if (href.match(/^[^:]+:/) && !href.match(/^https?:/)) {
            return;
        }

        try {
            if (href.includes('://') || href.startsWith('//')) 
            {
                // Handle protocol-relative URLs
                const integral_href = href.startsWith('//') ? `${url.protocol}${href}` : href;
                const href_url = new URL(integral_href);
                
                if (href_url.hostname === url.hostname) {
                    internal_hrefs.push(integral_href);
                } else {
                    external_hrefs.push(integral_href);
                }
            } else {
                internal_hrefs.push(href);
            }
        } catch (error) {
            console.error(`[ERROR] at page '${url.href}' for href '${href}': ${error.message}.`);
        }
    });
        
    return {
        internal_hrefs,
        external_hrefs
    };
}


