# Web app — library and sharing

Sounds and mixes are private or public. Public ones are listed on the Library page (preview,
add). A public mix holds public sounds and playlists only. This doc is a spec: the rules below
are the behavior the app promises.

## Added items keep their owner

Only the owner edits an added item. Everyone else sets their own volume and scenes, adds their
own tags, and can remove it from their library — the rest of its editor is greyed out.

## Publishing

Publishing a mix publishes the private sounds and playlists it holds, after a dialog that names
them. An invalid action is explained before it happens, never refused on the form after a click.

## Unpublish = remove, never propagate

An item made private leaves every public mix that holds it — the owner's own included, and those
mixes stay public. A dialog says first which of the owner's public mixes lose it, and how many
users added it.

## Removing from your library

- **An added mix** can always be removed. Its sounds still used elsewhere stay (the dialog says
  how many); unused ones are ticked to leave with it.
- **An added sound** is all or nothing: while a mix you added holds it, nothing changes and a
  dialog names that mix. Items reached only through an added mix leave with that mix.

## How many users added an item

An item carries a count of how many other users have it in their library, read the same way
everywhere ("Added by N game masters") as a bookmark and its number. Nobody adds their own item,
so the count is only ever other accounts; at zero the mark is greyed on a library row and hidden
on a tile. Unpublishing takes the item out of every library.

## Illustrations

An item shows no illustration, an icon, or an uploaded image. A client sends an icon by its id;
an image is uploaded separately. The icon picker covers the bundled icon sets; "choose image"
reuses an image already shown on an item the user can use. The icon and image pickers keep one
height and scroll their own grid.

## Library listing

- Lists newest first.
- Rows are readable on phones: under the name, what the item is; at the foot, who shared it and
  its license. The description and license sit under the row, full width.
- Empty sound and mix lists point to the Library.
