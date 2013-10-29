## Spew: firefox as feedreader

Spew is a firefox extension that lets the browser do all the heavy lifting. It
saves feeds and stories as bookmarks. To subscribe to a site, bookmark its
feed in the 'Feeds' folder. Wanna import *all* your google reader feeds?
There's an upload button in the addon toolbar.

Spew uses tabs for reading. To open (spew) a few unread items in new tabs, hit
ctrl-shift-o (configurable). Opening an item also 'marks it as read' (deletes
the bookmar).

# Installation

Needs the addon SDK: https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide/tutorials/installation.html

$ git clone http://github.com/akkartik/spew
$ cd spew
$ cfx xpi

This creates a file called spew.xpi. Drag it to your browser.
