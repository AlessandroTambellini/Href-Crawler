const https = require('https');
const http = require('http');
const util = require('node:util');
const debuglog = util.debuglog('log');

/* NOTE: to avoid confusion between an URL and a href, 
I'll consider them based on how Node.js considers them.
So, an URL is an object containing different properties (href, hostname, tags, etc.),
while a href is a string representing an address (e.g. 'http://example.org') */

const ORIGIN_HREF = process.argv[2];

main();

async function main() 
{
    const visited_hrefs = new Set();
    const url_queue = [];

    let origin_url = null;
    try {
        origin_url = new URL(ORIGIN_HREF);
    } catch (error) {
        console.error(`[ERROR]: '${ORIGIN_HREF}' is not a valid URL.`);
        return;
    }

    url_queue.push({
        'url': origin_url,
        'parent': null
    });
    visited_hrefs.add(ORIGIN_HREF);

    console.log(`Starting crawling at '${ORIGIN_HREF}'.`);

    let pages_crawled = 0;
    let external_links_checked = 0;

    while (url_queue.length > 0) 
    {
        const curr_url_wrapper = url_queue.shift();
        const curr_url = curr_url_wrapper.url;
        visited_hrefs.add(curr_url.href);
        pages_crawled++;

        const { HTML_page, msg } = await fetch_HTML_page(curr_url);

        if (!HTML_page && msg) {
            console.error(`(Line ${new Error().stack.split(':')[1]}) [ERROR] at page '${curr_url_wrapper.parent}' for href '${curr_url.href}'. Message: ${msg}.`);
            continue;
        } else if (!HTML_page && !msg) {
            debuglog(`[INFO] at page '${curr_url_wrapper.parent}' for href '${curr_url.href}'. The resource was successfully fetched, but it is not a HTML page.`);
            continue;
        }

        const hrefs = collect_hrefs(HTML_page);
        const { internal_hrefs, external_hrefs } = categorize_hrefs(hrefs, curr_url);
        debuglog(`'${curr_url.href}': found ${internal_hrefs.length} internal and ${external_hrefs.length} external hrefs.`);

        // Push the internal ones in the queue
        for (const href of internal_hrefs) {
            try {
                // Resolve a relative URL to the absolute one
                let abs_url = new URL(href, curr_url.href);
                if (!visited_hrefs.has(abs_url.href)) {
                    url_queue.push({ 
                        'url': abs_url,
                        'parent': curr_url.href
                    });
                    visited_hrefs.add(abs_url.href);
                }
            } catch (error) {
                console.error(`(Line ${new Error().stack.split(':')[1]}) [ERROR] '${curr_url.href}': the href '${href}' is not valid. Message: ${error}.`);
            }
        }
        
        // Verify the validity of the external ones
        debuglog('\tVisiting Externals:');
        for (const href of external_hrefs) {
            if (visited_hrefs.has(href)) continue;

            visited_hrefs.add(href);
            external_links_checked++;
            debuglog(`\t- ${href}`);

            try {
                const url = new URL(href);
                const { is_href_valid, msg } = await check_href_validity(url);
                if (!is_href_valid) {
                    console.warn(`[WARN]: Bad response for '${href}' contained in '${curr_url.href}'. Message: ${msg}.`);
                }
            } catch (error) {
                console.error(`(Line ${new Error().stack.split(':')[1]}) [ERROR] at page '${curr_url.href}' for href '${href}'. Message: ${error.message}.`);
            }
        }   
    }

    console.log(`[INFO]: pages crawled: ${pages_crawled}, external links checked: ${external_links_checked}.`);
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
        hrefs.push(match[2]);
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
        
        if (href.startsWith('javascript:') || 
            href.startsWith('mailto:') || 
            href.startsWith('tel:') ||
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
            console.error(`(Line ${new Error().stack.split(':')[1]}) [ERROR] at page '${url.href}' for href '${href}': ${error.message}.`);
        }
    });
        
    return {
        internal_hrefs,
        external_hrefs
    };
}


