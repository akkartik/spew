// https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide
// use https://addons.mozilla.org/en-US/firefox/addon/opml-support for importing

var tabs = require("sdk/tabs");
var timers = require("sdk/timers");
var widgets = require("sdk/widget");
var xhr = require("sdk/net/xhr");

// http://stackoverflow.com/questions/9171590/how-to-parse-a-xml-string-in-a-firefox-addon-using-add-on-sdk
const {Cc, Ci, Cu} = require("chrome");
var parser = Cc["@mozilla.org/xmlextras/domparser;1"].createInstance(Ci.nsIDOMParser);

// https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide/tutorials/event-targets.html
Cu.import("resource://gre/modules/XPCOMUtils.jsm", this);
const bookmarkService = Cc["@mozilla.org/browser/nav-bookmarks-service;1"].getService(Ci.nsINavBookmarksService);
const bookmarkMenu = bookmarkService.bookmarksMenuFolder;

var bookmarkObserver = {
  onItemAdded: function(aItemId, aFolder, aIndex) {
    console.log("added ", bookmarkService.getBookmarkURI(aItemId).spec);
  },
  onItemVisited: function(aItemId, aVisitID, time) {
    console.log("visited ", bookmarkService.getBookmarkURI(aItemId).spec);
  },
  QueryInterface: XPCOMUtils.generateQI([Ci.nsINavBookmarkObserver])
};

exports.main = function() {
  bookmarkService.addObserver(bookmarkObserver, false);
};

exports.onUnload = function() {
  bookmarkService.removeObserver(bookmarkObserver);
}

// https://developer.mozilla.org/en-US/docs/Places_Developer_Guide
// via http://stackoverflow.com/questions/10640667/how-can-firefox-add-on-access-users-bookmarks-folders
// via google: 'add-on sdk list bookmarks'
var history = Cc["@mozilla.org/browser/nav-history-service;1"].getService(Ci.nsINavHistoryService);
function findFolderUnderMenu(name) {
  console.log("find: "+name);
  var query = history.getNewQuery();
  query.setFolders([bookmarkMenu], 1);
  var result = history.executeQuery(query, history.getNewQueryOptions());
  var folderNode = result.root;
  folderNode.containerOpen = true;
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
  var folderId = findFolderUnderMenu(name);
  if (folderId > 0) return folderId;
  return bookmarkService.createFolder(bookmarkMenu, name, bookmarkService.DEFAULT_INDEX);
}

var ios = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);
function addItem(url) {
  var uri = ios.newURI(url, null, null);
  bookmarkService.insertBookmark(bookmarkService.bookmarksMenuFolder, uri, bookmarkService.DEFAULT_INDEX, "");
}

var widget = widgets.Widget({
  id: "mozilla-link",
  label: "Mozilla website",
  contentURL: "http://www.mozilla.org/favicon.ico",
  onClick: function() {
    // http://stackoverflow.com/questions/16369395/javascript-xmlhttprequest-onreadystatechange
    var req = new xhr.XMLHttpRequest();
    req.onreadystatechange = function() {
      console.log(req.readyState);
      if (req.readyState == 4) {
        var feed = parser.parseFromString(req.responseText, "application/xml");
        var urls = feed.getElementsByTagName("link");
        console.log(urls.length+" items");
        for (var i = 0; i < urls.length; ++i)
          console.log(i+": "+urls[i].innerHTML);
      }
    }
    req.open("GET", "http://akkartik.name/feed", /*async*/ true);
    req.send(null);
    var feedFolderId = ensureBookmarkFolder("Feeds");
    var itemFolderId = ensureBookmarkFolder("Feed Items");
  }
});
