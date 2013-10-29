## Spew: the UI-less feedreader

Spew is a minimalist firefox extension that lets the browser do all the heavy
lifting. All it does is crawl feeds in the background so you can read their
stories as they come in. Wanna add a feed? Just bookmark it into the 'Feeds'
folder. Wanna import *all* your google reader feeds? There's an upload button
in the addon toolbar. Wanna read some stories? Look in the 'Feed items'
bookmark folder, or just hit ctrl-shift-o (configurable) to open a few stories
in tabs.

#### Installation

You'll need the [addon SDK](https://addons.mozilla.org/en-US/developers/docs/sdk/latest/dev-guide/tutorials/installation.html).
Don't worry, it's super easy. Email me if you run into trouble or would like a
binary to install: [spew@akkartik.com](mailto:spew@akkartik.com)

    $ git clone http://github.com/akkartik/spew
    $ cd spew
    $ cfx xpi

This creates a file called `spew.xpi`. Drag it to your browser. You're all set!
