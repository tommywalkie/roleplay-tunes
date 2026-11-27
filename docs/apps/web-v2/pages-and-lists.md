# Web app — pages and lists

The shared mechanics of the list pages, and the per-user tags: synonyms and categories. This doc
is a spec: the rules below are the behavior the app promises.

## Search

The search field sticks to the top of the scrolling area; the title scrolls away. Search matches
an item's name and the synonyms the user sees on it, on list pages, in the Library, and in the
"choose" lists.

## Sort

A sort control sits beside the search field: by name either way, or by when the item was added.
Sorting is applied before the list is paged, and changing it returns to the first page.

## Pagination

Lists are paged. The pager sits at the foot of the list — held above the docked player on
phones and tablets, and at the foot of the window on desktop — so it is reachable even when the
list is short. Turning a page scrolls back to the top. A new search, filter or tab returns to
the first page.

## Synonyms and categories belong to each user

Each user puts their own on any item they own or added.

- On an item they see the owner's synonyms (not removable) and their own; only their own
  categories.
- A duplicate is the exact same text. A synonym no item carries is deleted by the server; a
  category stays until its owner deletes it.
- **Categories** are created, changed and deleted through one dialog, from the editor's field or
  from the Categories page (reached from Profile). The list pages filter by them. A category has
  a colour, an optional icon, and text that stays readable on its background.
