# Href Crawler
Href Crawler checks all links (hrefs) in a website, starting from a specified URL

## Run
```
node crawler.js <url>
```
To view the logs:
```
NODE_DEBUG=log node href-crawler.js <url>
```

## Description
Tool that checks all the hrefs associated with an anchor tag (&lt;a&gt;) in a web page, 
associated with the specified URL (for local ones, use localhost).  
Breakdown of its functionality:

1) **Starting point**:
It takes a URL as a command-line argument and begins crawling from there.

2) **Page crawling process**:
    - For each page, it fetches the HTML content
    - Extracts all anchor tags (`<a>`) with their **href** attribute
    - Categorizes each link as either "internal" (same hostname) or "external" (different hostname). It skips JavaScript pseudo-links, page-internal links, anchors (#), etc.

3) **Link checking**:
    - For internal links: It recursively visits each **unvisited** page, continuing the crawling process
    - For external links: It performs a HEAD request to verify if the link is valid without downloading content

## Note
Href Crawler doesn't handle all types of redirection to other locations and it doesn't cover all possible responses.
Also, the response back from a server might not be the expected one due to user-agent, encoding, proxy, etc. related stuff. This is to say that sometimes you may get a warning or an error for pages that from the browser are perfectly loadable and therefore this is more of a tool for personal usage; Indeed I use it to check for broken links in my website once in a while.
