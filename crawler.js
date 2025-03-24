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
const MAX_CONCURRENT_CHECKS = 20;

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

    const url_wrapper = {
        'url': origin_url,
        'parent': null
    };
    const internal_visited = new Set();
    const external_visited = new Set();
    const crawling_data = {
        pages_crawled: 0,
        external_hrefs_checked: 0
    };

    console.log(`Starting crawling at '${ORIGIN_HREF}'.`);

    await visit_page(url_wrapper, internal_visited, external_visited, crawling_data);

    console.log(`[INFO]: Pages crawled: ${crawling_data.pages_crawled}`);
    console.log(`[INFO]: External hrefs checked: ${crawling_data.external_hrefs_checked}`);
    console.log(`[INFO]: Crawling duration: ${((Date.now() - tot_time) / 1000).toFixed(2)}s`);
}

async function visit_page(url_wrapper, internal_visited, external_visited, crawling_data) 
{
    const url = url_wrapper.url;
    const { HTML_page, msg } = await fetch_HTML_page(url);
    internal_visited.add(url.href);

        if (!HTML_page && msg) {
        console.error(`[ERROR] at page '${url_wrapper.parent}' for href '${url.href}'. Message: ${msg}.`);
        return;
        } else if (!HTML_page && !msg) {
        debuglog(`At page '${url_wrapper.parent}' for href '${url.href}'. The resource was successfully fetched, but it is not a HTML page.`);
        return;
        }

    crawling_data.pages_crawled += 1;

        const hrefs = collect_hrefs(HTML_page);
    const { internal_hrefs, external_hrefs } = categorize_hrefs(hrefs, url);
    debuglog(`'${url.href}': Found ${internal_hrefs.length} internal and ${external_hrefs.length} external hrefs.`);

    /* 
     * 
     * Verify the validity of the external ones 
     */
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
                        console.warn(`[WARN]: Bad response for '${href}' contained in '${url.href}'. Message: ${msg}.`);
                        }
                    } catch (error) {
                    console.error(`[ERROR] at page '${url.href}' for href '${href}'. Message: ${error.message}.`);
                    }
                })();
            });
        
            await Promise.all(batch_promises);
    }
    
    crawling_data.external_hrefs_checked += unchecked_external_hrefs.length;

    /* 
     *
     * Verify the validity of the internal ones
     */
    const internal_to_visit = [];
    for (const href of internal_hrefs) {
        try {
            // Resolve a relative URL to the absolute one
            let abs_url = new URL(href, url.href);
            if (!internal_visited.has(abs_url.href)) {
                internal_to_visit.push({ 
                    'url': abs_url,
                    'parent': url.href
                });
            }
        } catch (error) {
            console.error(`[ERROR] '${url.href}': the href '${href}' is not valid. Message: ${error}.`);
        }
    }

    for (let i = 0; i < internal_to_visit.length; i += MAX_CONCURRENT_INTERNAL) 
    {
        const batch = internal_to_visit.slice(i, i + MAX_CONCURRENT_INTERNAL);
        const batch_promises = batch.map(url_wrapper => {
            return visit_page(url_wrapper, internal_visited, external_visited, crawling_data);
        });

        await Promise.all(batch_promises);
    }
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
            timeout: 5000
        };
        
        let is_href_valid = false;
        let msg = null;

        const module_to_use = url.protocol.split(':')[0] === 'http' ? http : https;
        const req = module_to_use.request(url, options);
        req.end();

        let f_res_already_catched = false;

        req.on('response', (res) => {
            if (f_res_already_catched) return;
            f_res_already_catched = true;
            
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
            if (f_res_already_catched) return;
            f_res_already_catched = true;
            msg = 'timeout';
            req.destroy();
        });
        
        req.on('error', (err) => {
            if (f_res_already_catched) return;
            f_res_already_catched = true;
            msg = err.message;
        });

        req.on('close', () => {
            req.destroy();
            resolve({ 
                is_href_valid,
                msg
            });
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
            timeout: 5000
        };

        const module_to_use = url.protocol.split(':')[0] === 'http' ? http : https;
        let req = module_to_use.request(url, options);
        req.end();
        
        let f_res_already_catched = false;
        let HTML_page = null;
        let msg = null;    
        
        req.on('response', res => {
            if (f_res_already_catched) return;
            f_res_already_catched = true;

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
            if (f_res_already_catched) return;
            f_res_already_catched = true;
            msg = 'timeout';
            req.destroy();
        });
        
        req.on('error', (err) => 
        {
            if (f_res_already_catched) return;
            f_res_already_catched = true;
            msg = err.message;
        });
        
        req.on('close', () => {
            /* I noticed that the underlying sockets might remain open, so I explicitely close them.
            I noticed it because once the crawling was terminated, before the program terminated, 5-10 seconds passed by. */
            req.destroy(); 
            resolve({
                HTML_page,
                msg
            });
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
        
        if (href.includes(':') && !['http:', 'https:'].some(protocol => href.startsWith(protocol)) ||
            href.startsWith('#')) {
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


