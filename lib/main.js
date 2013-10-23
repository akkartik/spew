// A chromeless feedreader.
// Saves state including feeds and items in special bookmark folders.
// Provides a keyboard shortcut to load a few recently-crawled items to new
// tabs, marking them read in the process.
// 'Import feeds' in the Bookmarks menu. Add feed urls to the Feeds folder to
// queue them up for crawling.
//
// https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide/

const {Cc, Ci, Cu} = require("chrome");
const file = require("sdk/io/file");

//// CORE DATA STRUCTURES are bookmark folders: for feeds and for unread items
var feedFolderId;
var itemFolderId;
// High-water mark for crawling feeds.
// We track how far we've crawled by adding a folder under this with the
// feed url which contains a single bookmark with the most recent post we've
// seen from the feed.
var crawledFolderId;

//// CRAWL FEEDS
const timers = require("sdk/timers");
var periodicTaskId;
exports.main = function() {
  feedFolderId = ensureBookmarkFolder("Feeds");
  itemFolderId = ensureBookmarkFolder("Feed Items");
  crawledFolderId = ensureBookmarkFolder("Feeds crawled until");
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
    log(runtag, "no feeds to crawl");
    return;
  }
  if (currentlyCrawlingIndex >= folderNode.childCount) {
    log(runtag, "wrapping around to feed 0");
    currentlyCrawlingIndex = 0;
    // slow down crawling after the first go-through
    timers.clearInterval(periodicTaskId);
    periodicTaskId = timers.setInterval(periodicTask, 60*1000);
  }
  log(runtag, "about to crawl "+(currentlyCrawlingIndex+1)+"/"+folderNode.childCount);
  var bookmark = folderNode.getChild(currentlyCrawlingIndex);
  crawlFeed(runtag, bookmark.uri);
  ++currentlyCrawlingIndex;
}

const xhr = require("sdk/net/xhr");
function crawlFeed(runtag, url) {
  log(runtag, "crawling feed "+url);
  var req = new xhr.XMLHttpRequest();
  req.onreadystatechange = function() {
    if (req.readyState == 4) {
      log(runtag, "received feed for "+url);
      addNewItems(runtag, url, req.responseText);
    }
  }
  req.open("GET", url, /*async*/ true);
  req.send(null);
}

const parser = Cc["@mozilla.org/xmlextras/domparser;1"].createInstance(Ci.nsIDOMParser);
function addNewItems(runtag, feedurl, body) {
  var urls = feedItems(runtag, feedurl, parser.parseFromString(body.trim(), "application/xml"));
  log(runtag, "adding "+urls.length+" urls");
  for (var i = 0; i < urls.length; ++i) {
    if (isBookmarked(urls[i])) {
      log(runtag, urls[i]+" already exists");
      break;
    }
    log(runtag, "adding "+urls[i]);
    addItem(urls[i]);
  }
  log(runtag, "updating high-water mark for "+feedurl);
  var url = items[0].getElementsByTagName("link")[0].innerHTML;
  updateHighWaterMark(feedurl, url);
}

function feedItems(runtag, feedurl, feed) {
  var result = [];
  log(runtag, "feedItems");
  // http://www.w3schools.com/dom/dom_errors_crossbrowser.asp
  if (feed.documentElement.nodeName == "parsererror") {
    log(runtag, "error: "+feed.childNodes[1].innerHTML);
    return result;
  }

  // RSS
  var items = feed.getElementsByTagName("item");
  log(runtag, items.length+" items");
  for (var i = 0; i < items.length; ++i) {
    links = items[i].getElementsByTagName("link");
    if (links.length > 0) result.push(links[0].innerHTML);
  }

  if (items.length > 0) return result;
  else log(runtag, "Trying to parse as an atom feed");

  // Atom
  var base = baseUrl(runtag, feedurl, feed);
  log(runtag, "baseUrl: "+base);
  var entries = feed.getElementsByTagName("entry");
  log(runtag, entries.length+" entries");
  for (var i = 0; i < entries.length; ++i) {
    links = entries[i].getElementsByTagName("link");
    if (links.length > 0)
      result.push(absolutify(base, links[0].getAttribute('href')));
  }

  log(runtag, result.length+" urls");
  return result;
}

function absolutify(base, path) {
  console.log("absolutify: "+base+" vs "+path);
  if (!path.match(/^\//)) return path;
  console.log("  appending");
  return base+path;
}

// Extremely hacky: just working with feeds I've seen without reading the #$%#
// atom spec.
function baseUrl(runtag, feedurl, feed) {
  log(runtag, "baseUrl");
  var feedXmlBase = feed.getElementsByTagName("feed");
  if (feedXmlBase.length > 0) feedXmlBase = feedXmlBase[0].getAttribute("xml:base");
  else feedXmlBase = "";
  feedXmlBase = feedXmlBase.replace(/\/$/, '');
  log(runtag, "feed xml:base "+feedXmlBase);
  var firstLink = feed.getElementsByTagName("link");
  if (firstLink.length > 0) firstLink = firstLink[0].getAttribute("href");
  else firstLink = "";
  firstLink = firstLink.replace(/\/$/, '');
  log(runtag, "link tag: "+firstLink);
  // hack: only look at immediate children
  var firstItemLink = feed.getElementsByTagName("entry");
  log(runtag, "AA");
  if (firstItemLink.length > 0) firstItemLink = firstItemLink[0].getAttribute('href');
  else firstItemLink = "";
  log(runtag, "BB: "+firstItemLink);
  if (firstItemLink) firstItemLink = firstItemLink.replace(/\/$/, '');
  else firstItemLink = "";
  log(runtag, "CC");
  log(runtag, "first item link: "+firstItemLink);
  if (firstLink == firstItemLink) firstLink = "";
  // does <link> really overrule feed's xml:base? Or is this a bug in
  // http://plasmasturm.org/feeds/plasmasturm?
  if (firstLink != "") return firstLink;
  if (feedXmlBase != "") return feedXmlBase;
  return dirname(feedurl);
}

// https://developer.mozilla.org/en-US/docs/Places_Developer_Guide
const bookmarkService = Cc["@mozilla.org/browser/nav-bookmarks-service;1"].getService(Ci.nsINavBookmarksService);
const bookmarkMenu = bookmarkService.bookmarksMenuFolder;
const ios = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
function addItem(url) {
  var uri = ios.newURI(url, null, null);
  bookmarkService.insertBookmark(itemFolderId, uri, bookmarkService.DEFAULT_INDEX, "");
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
  bookmarkService.insertBookmark(folderId, uri, bookmarkService.DEFAULT_INDEX, "");
  log(runtag, "high-water mark is now "+url);
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

const historyService = Cc["@mozilla.org/browser/nav-history-service;1"].getService(Ci.nsINavHistoryService);
function folderContents(folderId) {
  var query = historyService.getNewQuery();
  query.setFolders([folderId], 1);
  var result = historyService.executeQuery(query, historyService.getNewQueryOptions());
  result.root.containerOpen = true;
  return result.root;
}

//// READ
const widgets = require("sdk/widget");
const tabs = require("sdk/tabs");
var widget = widgets.Widget({
  id: "spew",
  label: "Spew more things to read",
  contentURL: "http://akkartik.name/favicon.ico",
  onClick: openSomeItems,
});

function openSomeItems() {
  log("interactive", "new tabs requested");
}

const {Hotkey} = require("sdk/hotkeys");
Hotkey({combo: "accel-shift-o", onPress: openSomeItems});

//// IMPORT FEEDS
// https://addons.mozilla.org/en-US/developers/docs/sdk/latest/modules/sdk/context-menu.html
// because https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide/tutorials/adding-menus.html
// is broken.
const menu = require("sdk/context-menu");
menu.Item({
  id: "spew: import feeds",
  menuid: "menu_Bookmarks",
  label: "import feeds",
  context: menu.PageContext(),
  contentScript: 'self.on("click", function(node, data){self.postMessage();});',
  onMessage: function() {
    log("interactive", "import menu clicked");
    if (filePicker.show() == Ci.nsIFilePicker.returnOK) {
      log("interactive", "user chose file "+filePicker.file.path);
      addFeedsFromFile(filePicker.file.path);
    }
  }
});
Hotkey({combo: "F12", onPress: function() {
  log("interactive", "F12 pressed");
  if (filePicker.show() == Ci.nsIFilePicker.returnOK) {
    log("interactive", "user chose file "+filePicker.file.path);
    addFeedsFromFile(filePicker.file.path);
  }
}});

function addFeedsFromFile(feeds) {
  var opml = parser.parseFromString(file.read(feeds), "application/xml");
  var feeds = opml.getElementsByTagName("outline");
  for (var i = 0; i < feeds.length; ++i) {
    addFeed(feeds[i].getAttribute('xmlUrl'));
  }
}

function addFeed(url) {
  log("interactive", "about to add "+url);
  var uri = ios.newURI(url, null, null);
  bookmarkService.insertBookmark(feedFolderId, uri, bookmarkService.DEFAULT_INDEX, "");
}

// http://zderadicka.eu/writing-to-file-in-firefox-extension
const filePicker = Cc["@mozilla.org/filepicker;1"].createInstance(Ci.nsIFilePicker);
function initFilePicker() {
  filePicker.init(require("sdk/window/utils").getMostRecentBrowserWindow(), "Open Feed", Ci.nsIFilePicker.modeOpen);
  filePicker.appendFilters("*.xml");
}

//// Internals

var logStream = file.open("/tmp/spew.log."+Date.now(), "w");
function log(runtag, x) {
  console.log(Date.now()+" "+runtag+": "+x);
//?   logStream.write(Date.now()+" "+runtag+": "+x+"\n");
}

function dirname(path) {
  return path.match(/.*\//);
}
