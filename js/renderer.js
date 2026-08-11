// Renderer functions - build wiki page HTML, fix URLs, build TOC
const WIKI_BASE = 'https://pt.wikipedia.org';

function fixRelativeUrls(html) {
  let fixed = html.replace(/(src|href|data-src)="(\/[^"\/#][^"]*)"/g, function(match, attr, url) {
    if (url.startsWith('//')) {
      return attr + '="https:' + url + '"';
    }
    if (url.startsWith('/w/') || url.startsWith('/wiki/')) {
      return attr + '="' + WIKI_BASE + url + '"';
    }
    return match;
  });

  fixed = fixed.replace(/srcset="([^"]+)"/g, function(match, srcset) {
    return 'srcset="' + srcset.replace(/(\/w\/[^,\s]+|\/wiki\/[^,\s]+)/g, WIKI_BASE + '$1').replace(/^\/\//, 'https://') + '"';
  });

  fixed = fixed.replace(/url\((\/w\/[^)]+)\)/g, 'url(' + WIKI_BASE + '$1)');
  fixed = fixed.replace(/url\((\/\/[^)]+)\)/g, 'url(https:$1)');

  return fixed;
}

function buildWikiPage(html, title, sections) {
  var wikiCSS = '<style>' +
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #202122; padding: 20px 24px; max-width: 960px; margin: 0 auto; line-height: 1.6; font-size: 14px; }' +
    'a { color: #0645ad; text-decoration: none; } a:hover { text-decoration: underline; } a:visited { color: #0b0080; } a.new { color: #d33; } a.external { color: #36b; }' +
    'h1, h2, h3, h4, h5, h6 { font-family: "Linux Libertine", "Georgia", "Times", serif; color: #202122; line-height: 1.3; margin: 0; padding: 0; }' +
    'h1 { font-size: 28px; font-weight: 400; border-bottom: 1px solid #a2a9b1; margin: 0.4em 0; padding-bottom: 0.2em; }' +
    'h2 { font-size: 22px; font-weight: 400; border-bottom: 1px solid #a2a9b1; margin: 1em 0 0.4em; padding-bottom: 0.2em; }' +
    'h3 { font-size: 17px; font-weight: 700; margin: 0.8em 0 0.3em; }' +
    'h4 { font-size: 15px; font-weight: 700; margin: 0.6em 0 0.2em; }' +
    'h5, h6 { font-size: 14px; font-weight: 700; margin: 0.6em 0 0.2em; }' +
    'p { margin: 0.5em 0; line-height: 1.6; }' +
    'table.infobox { background: #f8f9fa; border: 1px solid #a2a9b1; border-collapse: collapse; float: right; margin: 0 0 1em 1em; width: auto; max-width: 320px; font-size: 12.5px; line-height: 1.4; clear: right; }' +
    'table.infobox caption { font-size: 14px; font-weight: 700; padding: 0.4em; text-align: center; }' +
    'table.infobox th, table.infobox td { padding: 0.4em 0.6em; vertical-align: top; border: 1px solid #eaecf0; }' +
    'table.infobox th { background: #eaecf0; font-weight: 600; text-align: left; }' +
    'table.infobox .infobox-header { background: #ddd; font-weight: 700; text-align: center; }' +
    'table.wikitable { background: #f8f9fa; border: 1px solid #a2a9b1; border-collapse: collapse; margin: 1em 0; font-size: 13px; }' +
    'table.wikitable caption { font-size: 14px; font-weight: 700; padding: 0.4em; text-align: center; background: #eaecf0; }' +
    'table.wikitable th, table.wikitable td { padding: 0.4em 0.6em; border: 1px solid #a2a9b1; vertical-align: top; }' +
    'table.wikitable th { background: #eaecf0; font-weight: 600; text-align: left; }' +
    'table.wikitable tr:hover { background: #f0f0f0; }' +
    'table:not(.infobox):not(.wikitable):not(.navbox):not(.sidebar) { border-collapse: collapse; margin: 0.5em 0; font-size: 13px; }' +
    'table:not(.infobox):not(.wikitable):not(.navbox):not(.sidebar) th, table:not(.infobox):not(.wikitable):not(.navbox):not(.sidebar) td { padding: 0.3em 0.5em; border: 1px solid #a2a9b1; vertical-align: top; }' +
    'table:not(.infobox):not(.wikitable):not(.navbox):not(.sidebar) th { background: #eaecf0; font-weight: 600; }' +
    'ul, ol { margin: 0.3em 0 0.3em 1.6em; padding: 0; }' +
    'li { margin: 0.2em 0; line-height: 1.5; }' +
    'ul ul, ol ol, ul ol, ol ul { margin: 0.2em 0 0.2em 1.2em; }' +
    'figure { margin: 0.5em 0; padding: 0; }' +
    'figcaption { font-size: 12px; color: #54595d; line-height: 1.4; margin-top: 0.3em; }' +
    'img { max-width: 100%; height: auto; }' +
    '.thumb { margin: 0.5em 0; }' +
    '.thumbinner { background: #f8f9fa; border: 1px solid #c8ccd1; padding: 0.3em; display: inline-block; }' +
    '.thumbcaption { font-size: 12px; color: #54595d; line-height: 1.4; padding-top: 0.3em; }' +
    '.tright { float: right; clear: right; margin: 0.5em 0 0.5em 1em; }' +
    '.tleft { float: left; clear: left; margin: 0.5em 1em 0.5em 0; }' +
    'blockquote { border-left: 3px solid #a2a9b1; margin: 0.5em 0; padding: 0.3em 1em; background: #f8f9fa; font-style: italic; }' +
    '.hatnote, .dablink, .relart { background: #f8f9fa; border: 1px solid #eaecf0; padding: 0.4em 0.8em; margin: 0.5em 0; font-size: 13px; font-style: italic; color: #54595d; }' +
    '.references { font-size: 12px; line-height: 1.4; margin-top: 1em; }' +
    '.references ol { padding-left: 1.5em; margin: 0.5em 0; }' +
    '.references li { margin: 0.2em 0; }' +
    'hr { border: none; border-top: 1px solid #a2a9b1; margin: 1em 0; height: 0; }' +
    'code { background: #f8f9fa; border: 1px solid #eaecf0; border-radius: 2px; padding: 0.1em 0.3em; font-family: "Courier New", monospace; font-size: 13px; }' +
    'pre { background: #f8f9fa; border: 1px solid #a2a9b1; padding: 0.5em; overflow-x: auto; font-family: "Courier New", monospace; font-size: 13px; line-height: 1.4; }' +
    'sup, sub { font-size: 0.75em; line-height: 1; }' +
    'b, strong { font-weight: 700; }' +
    'i, em { font-style: italic; }' +
    '.mw-editsection, .reference, .mw-cite-backlink, table.navbox, .vertical-navbox, .metadata, .ambox, .catlinks, .noprint { display: none !important; }' +
    'td[colspan], th[colspan] { text-align: center; }' +
    'td[rowspan], th[rowspan] { vertical-align: middle; }' +
    '</style>';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' + wikiCSS + '</head><body>' +
    '<div class="article-content">' + html + '</div></body></html>';
}
