// A chromeless RSS reader.
// Saves state including feeds and items in special bookmark folders.
// Provides a keyboard shortcut to load a few recently-crawled items to new
// tabs, marking them read in the process.
// 'Import feeds' in the Bookmarks menu. Add feed urls to the Feeds folder to
// queue them up for crawling.
//
// https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide/

const {Cc, Ci, Cu} = require("chrome");
Cu.import("resource://gre/modules/XPCOMUtils.jsm", this);

//// CORE DATA STRUCTURES are bookmark folders: for feeds and for unread items
var feedFolderId;
var itemFolderId;
// High-water mark for crawling feeds.
// We track how far we've crawled by adding a folder under this with the
// feed url which contains a single bookmark with the most recent post we've
// seen from the feed.
var crawledFolderId;

const timers = require("sdk/timers");
var periodicTaskId;
exports.main = function() {
  feedFolderId = ensureBookmarkFolder("Feeds");
  itemFolderId = ensureBookmarkFolder("Feed Items");
  crawledFolderId = ensureBookmarkFolder("Feeds crawled until");

  periodicTaskId = timers.setInterval(periodicTask, 5000);
}
exports.onUnload = function() {
  timers.clearInterval(periodicTaskId);
}

var periodicRunIndex = 0;  // passed around as runtag to debug periodic tasks
function periodicTask() {
  crawlFeed(periodicRunIndex, "http://akkartik.name/feed");
  ++periodicRunIndex;
}
function log(runtag, x) {
  console.log(Date.now()+" "+runtag+": "+x);
}

const historyService = Cc["@mozilla.org/browser/nav-history-service;1"].getService(Ci.nsINavHistoryService);
function folderContents(folderId) {
  var query = historyService.getNewQuery();
  query.setFolders([folderId], 1);
  var result = historyService.executeQuery(query, historyService.getNewQueryOptions());
  result.root.containerOpen = true;
  return result.root;
}

const xhr = require("sdk/net/xhr");
function crawlFeed(runtag, url) {
  log(runtag, "crawling feed "+url);
  // http://stackoverflow.com/questions/16369395/javascript-xmlhttprequest-onreadystatechange
  var req = new xhr.XMLHttpRequest();
  req.onreadystatechange = function() {
    if (req.readyState == 4) {
      log(runtag, "received feed for "+url);
      parseFeed(runtag, url, req.responseText);
    }
  }
  req.open("GET", url, /*async*/ true);
  req.send(null);
}

const parser = Cc["@mozilla.org/xmlextras/domparser;1"].createInstance(Ci.nsIDOMParser);
function parseFeed(runtag, feedurl, body) {
  var feed = parser.parseFromString(body, "application/xml");
  var items = feed.getElementsByTagName("item");
  log(runtag, items.length+" items");
  for (var i = 0; i < items.length; ++i) {
    var url = items[i].getElementsByTagName("link")[0].innerHTML;
    if (isBookmarked(url)) {
      log(runtag, url+" already exists");
      break;
    }
    log(runtag, "adding "+url);
    addItem(url);
  }
  log(runtag, "updating high-water mark for "+feedurl);
  var url = items[0].getElementsByTagName("link")[0].innerHTML;
  updateHighWaterMark(feedurl, url);
}

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

// https://developer.mozilla.org/en-US/docs/Places_Developer_Guide
// via http://stackoverflow.com/questions/10640667/how-can-firefox-add-on-access-users-bookmarks-folders
// via google: 'add-on sdk list bookmarks'
function findFolderUnder(folderId, name) {
  console.log("find: "+name);
  var folderNode = folderContents(folderId);
  for (var i=0; i < folderNode.childCount; ++i) {
    var childNode = folderNode.getChild(i);
    if (childNode.type == Ci.nsINavHistoryResultNode.RESULT_TYPE_FOLDER
        && childNode.title == name) {
      console.log("found!");
      return childNode.itemId;
    }
  }
  return 0;
}

// https://developer.mozilla.org/en-US/docs/Code_snippets/Bookmarks
function ensureBookmarkFolder(name) {
  console.log(name);
  var folderId = findFolderUnder(bookmarkMenu, name);
  if (folderId > 0) return folderId;
  return bookmarkService.createFolder(bookmarkMenu, name, bookmarkService.DEFAULT_INDEX);
}

const widgets = require("sdk/widget");
const tabs = require("sdk/tabs");
var widget = widgets.Widget({
  id: "spew",
  label: "Spew more things to read",
  contentURL: "http://akkartik.name/favicon.ico",
  onClick: function() {
  }
});
