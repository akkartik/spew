// A chromeless feedreader.
// Saves state including feeds and items in special bookmark folders.
// Provides a keyboard shortcut to load a few recently-crawled items to new
// tabs, marking them read in the process.
// 'Import feeds' in the Bookmarks menu. Add feed urls to the Feeds folder to
// queue them up for crawling.
//
// https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide/

const {Cc, Ci, Cu} = require('chrome');
const file = require('sdk/io/file');

//// CORE DATA STRUCTURES are bookmark folders: for feeds and for unread items
var feedFolderId;
var itemFolderId;
// High-water mark for crawling feeds.
// We track how far we've crawled by adding a folder under this with the
// feed url which contains a single bookmark with the most recent post we've
// seen from the feed.
var crawledFolderId;

//// CRAWL FEEDS
const timers = require('sdk/timers');
var periodicTaskId;
exports.main = function() {
  feedFolderId = ensureBookmarkFolder('Feeds');
  itemFolderId = ensureBookmarkFolder('Feed Items');
  crawledFolderId = ensureBookmarkFolder('Feeds crawled until');
  initFilePicker();

  // fetch all feeds quickly the first time around
  periodicTaskId = timers.setInterval(periodicTask, 5000);
}
exports.onUnload = function() {
  timers.clearInterval(periodicTaskId);
}

var periodicRunIndex = 0;  // passed around as runtag to debug periodic tasks
function periodicTask() {
  crawlSomeFeeds(periodicRunIndex);
  ++periodicRunIndex;
}

var currentlyCrawlingIndex = 0;
function crawlSomeFeeds(runtag) {
  var folderNode = folderContents(feedFolderId);
  if (folderNode.childCount <= 0) {
    log(runtag, 'no feeds to crawl');
    return;
  }
  if (currentlyCrawlingIndex >= folderNode.childCount) {
    log(runtag, 'wrapping around to feed 0');
    currentlyCrawlingIndex = 0;
    // slow down crawling after the first go-through
    timers.clearInterval(periodicTaskId);
    periodicTaskId = timers.setInterval(periodicTask, 60*1000);
  }
  log(runtag, 'about to crawl '+(currentlyCrawlingIndex+1)+'/'+folderNode.childCount);
  var bookmark = folderNode.getChild(currentlyCrawlingIndex);
  crawlFeed(runtag, bookmark.uri);
  ++currentlyCrawlingIndex;
}

const xhr = require('sdk/net/xhr');
function crawlFeed(runtag, url) {
  log(runtag, 'crawling feed '+url);
  var req = new xhr.XMLHttpRequest();
  req.onreadystatechange = function() {
    if (req.readyState == 4) {
      log(runtag, 'received feed for '+url);
      addNewItems(runtag, url, req.responseText);
    }
  }
  req.open('GET', url, /*async*/ true);
  req.send(null);
}

const parser = Cc['@mozilla.org/xmlextras/domparser;1'].createInstance(Ci.nsIDOMParser);
function addNewItems(runtag, feedurl, body) {
try {
  var items = feedItems(runtag, feedurl, parser.parseFromString(body.trim(), 'application/xml'));
  log(runtag, 'adding '+items.length+' items');
  for (var i = 0; i < items.length; ++i) {
    if (isBookmarked(items[i].url)) {
      log(runtag, items[i].url +' already exists');
      break;
    }
    log(runtag, 'adding '+items[i].url);
    addItem(items[i]);
  }
  log(runtag, 'updating high-water mark for '+feedurl+' to '+items[0].url);
  updateHighWaterMark(feedurl, items[0].url);
} catch (e) { log(runtag, e); }
}

function feedItems(runtag, feedurl, feed) {
try {
  var result = [];
  log(runtag, 'feedItems');
  // http://www.w3schools.com/dom/dom_errors_crossbrowser.asp
  if (feed.documentElement.nodeName == 'parsererror') {
    log(runtag, 'error: '+feed.childNodes[1].innerHTML);
    return result;
  }

  // RSS
  var items = feed.getElementsByTagName('item');
  log(runtag, items.length+' items');
  for (var i = 0; i < items.length; ++i) {
    var url = getUrlFromGuid(runtag, feedurl, items[i]);
    if (url) {
      result.push({url: url,
                   title: getTitle(items[i]) || url});
      continue;
    }
    var links = items[i].getElementsByTagName('link');
    if (links.length > 0) {
      var url = links[0].innerHTML;
      result.push({url: url,
                   title: getTitle(items[i]) || url});
    }
  }

  if (items.length > 0) return result;
  else log(runtag, 'Trying to parse as an atom feed');

  // Atom
  var base = baseUrl(runtag, feedurl, feed);
  log(runtag, 'baseUrl: '+base);
  var entries = feed.getElementsByTagName('entry');
  log(runtag, entries.length+' entries');
  for (var i = 0; i < entries.length; ++i) {
    var links = entries[i].getElementsByTagName('link');
    if (links.length > 0) {
      var url = getUrlFromGuid(runtag, feedurl, entries[i]);
      if (!url)
        var url = absolutify(base, getUrl(links));
      result.push({url: url,
                   title: getTitle(entries[i]) || url});
    }
  }

  log(runtag, result.length+' urls');
  return result;
} catch (e) { log('feedItems', e); }
}

const ios = Cc['@mozilla.org/network/io-service;1'].getService(Ci.nsIIOService);
function getUrlFromGuid(runtag, feedurl, entry) {
  try {
    var guid = entry.getElementsByTagName('guid')[0].innerHTML;
    ios.newURI(guid, null, null);
    return guid;
  } catch(e) {
  }
}

function getTitle(entry) {
  try {
    return entry.getElementsByTagName('title')[0].innerHTML;
  } catch (anything) {
  }
}

function getUrl(links) {
  if (links.length == 0) return '';
  for (var i = 0; i < links.length; ++i)
    if (links[i].getAttribute('rel') == 'alternate'
        && links[i].getAttribute('type') == 'text/html')
      return links[i].getAttribute('href');
  return links[0].getAttribute('href');
}

function absolutify(base, path) {
  if (!path.match(/^\//)) return path;
  return base+path;
}

// Extremely hacky: just working with feeds I've seen without reading the #$%#
// atom spec.
function baseUrl(runtag, feedurl, feed) {
  function munge(elems, attr) {
    var result = '';
    if (elems.length > 0) result = elems[0].getAttribute(attr) || '';
    result = result.replace(/\/$/, '');
    return result;
  }
  var feedXmlBase = munge(feed.getElementsByTagName('feed'), 'xml:base');
  var firstLink = munge(feed.getElementsByTagName('link'), 'href');
  var firstItemLink = feed.getElementsByTagName('entry');
  // hack: only look at immediate children
  if (firstItemLink.length > 0)
    firstItemLink = munge(firstItemLink[0].getElementsByTagName('link'), 'href');
  if (firstLink == firstItemLink) firstLink = '';
  // does <link> really overrule feed's xml:base? Or is this a bug in
  // http://plasmasturm.org/feeds/plasmasturm?
  if (firstLink != '') return firstLink;
  if (feedXmlBase != '') return feedXmlBase;
  return dirname(feedurl);
}

// https://developer.mozilla.org/en-US/docs/Places_Developer_Guide
const bookmarkService = Cc['@mozilla.org/browser/nav-bookmarks-service;1'].getService(Ci.nsINavBookmarksService);
const bookmarkMenu = bookmarkService.bookmarksMenuFolder;
function addItem(item) {
  var uri = ios.newURI(item.url, null, null);
  bookmarkService.insertBookmark(itemFolderId, uri, bookmarkService.DEFAULT_INDEX, item.title);
}
function isBookmarked(url) {
  var uri = ios.newURI(url, null, null);
  return bookmarkService.getBookmarkedURIFor(uri);
}

function updateHighWaterMark(feedurl, url) {
  var folderId = findFolderUnder(crawledFolderId, feedurl);
  if (folderId == 0)
    folderId = bookmarkService.createFolder(crawledFolderId, feedurl, bookmarkService.DEFAULT_INDEX);
  bookmarkService.removeFolderChildren(folderId);
  var uri = ios.newURI(url, null, null);
  bookmarkService.insertBookmark(folderId, uri, bookmarkService.DEFAULT_INDEX, '');
}

function highWaterUrl(feedurl) {
  var highWaterFolder = findFolderUnder(crawledFolderId, feedurl);
  if (highWaterFolder == 0) return '(nil)';
  var folderNode = folderContents(highWaterFolder);
  if (folderNode.childCount == 0) return '(nil)';
  return folderNode.getChild(0).uri;
}

function ensureBookmarkFolder(name) {
  var folderId = findFolderUnder(bookmarkMenu, name);
  if (folderId > 0) return folderId;
  return bookmarkService.createFolder(bookmarkMenu, name, bookmarkService.DEFAULT_INDEX);
}

function findFolderUnder(folderId, name) {
  var folderNode = folderContents(folderId);
  for (var i=0; i < folderNode.childCount; ++i) {
    var childNode = folderNode.getChild(i);
    if (childNode.type == Ci.nsINavHistoryResultNode.RESULT_TYPE_FOLDER
        && childNode.title == name) {
      return childNode.itemId;
    }
  }
  return 0;
}

const historyService = Cc['@mozilla.org/browser/nav-history-service;1'].getService(Ci.nsINavHistoryService);
function folderContents(folderId) {
  var query = historyService.getNewQuery();
  query.setFolders([folderId], 1);
  var result = historyService.executeQuery(query, historyService.getNewQueryOptions());
  result.root.containerOpen = true;
  return result.root;
}

//// READ
const tabs = require('sdk/tabs');
const prefs = require('sdk/simple-prefs');
function openSomeItems() {
  log('interactive', 'new tabs requested');
  var folderNode = folderContents(itemFolderId);
  for (var i = 0; i < prefs.prefs['TABS_AT_A_TIME']; ++i) {
    if (i >= folderNode.childCount) return;
    var index = rand(folderNode.childCount);
    log('interactive', 'index '+index+'/'+folderNode.childCount);
    var bookmark = folderNode.getChild(index);
    log('interactive', 'opening '+bookmark.uri);
    tabs.open(bookmark.uri);
    log('interactive', 'erasing '+bookmark.itemId);
    bookmarkService.removeItem(bookmark.itemId);
  }
}

const {Hotkey} = require('sdk/hotkeys');
Hotkey({combo: prefs.prefs['READ_HOTKEY'], onPress: openSomeItems});

//// IMPORT FEEDS
const widgets = require('sdk/widget');
var widget = widgets.Widget({
  id: 'spew-import',
  label: 'Import OPML into Spew',
  contentURL: 'http://akkartik.name/favicon.ico',
  onClick: importFeeds,
});

function importFeeds() {
  if (filePicker.show() == Ci.nsIFilePicker.returnOK) {
    log('interactive', 'user chose file '+filePicker.file.path);
    addFeedsFromFile(filePicker.file.path);
  }
}

function addFeedsFromFile(feeds) {
  var opml = parser.parseFromString(file.read(feeds), 'application/xml');
  var feeds = opml.getElementsByTagName('outline');
  for (var i = 0; i < feeds.length; ++i) {
    addFeed(feeds[i].getAttribute('xmlUrl'), feeds[i].getAttribute('title'));
  }
}

function addFeed(url, title) {
  log('interactive', 'about to add '+url);
  var uri = ios.newURI(url, null, null);
  bookmarkService.insertBookmark(feedFolderId, uri, bookmarkService.DEFAULT_INDEX, title);
}

// http://zderadicka.eu/writing-to-file-in-firefox-extension
const filePicker = Cc['@mozilla.org/filepicker;1'].createInstance(Ci.nsIFilePicker);
function initFilePicker() {
  filePicker.init(require('sdk/window/utils').getMostRecentBrowserWindow(), 'Open Feed', Ci.nsIFilePicker.modeOpen);
  filePicker.appendFilters('*.xml');
}

//// Internals

var logStream = file.open('/tmp/spew.log.'+Date.now(), 'w');
function log(runtag, x) {
//?   console.log(Date.now()+' '+runtag+': '+x);  // convenient from cfx
  logStream.write(Date.now()+' '+runtag+': '+x+'\n');
  logStream.flush();
}

function dumpToFile(contents, name) {
  var f = file.open(name, 'w');
  f.write(contents);
  f.close();
}

function dirname(path) {
  return path.replace(/\/[^\/]*$/, '');
}

function rand(max) {
  return Math.floor(Math.random()*max);
}
