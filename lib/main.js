// https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide

var tabs = require("sdk/tabs");
var timers = require("sdk/timers");
var widgets = require("sdk/widget");
var xhr = require("sdk/net/xhr");

// http://stackoverflow.com/questions/9171590/how-to-parse-a-xml-string-in-a-firefox-addon-using-add-on-sdk
var {Cc, Ci} = require("chrome");
var parser = Cc["@mozilla.org/xmlextras/domparser;1"].createInstance(Ci.nsIDOMParser);

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
  }
});
