# Server — sharing

Public sounds and mixes, the libraries of the users who added them, and the images items share.
This doc is a spec: the rules below are the behavior the server promises.

## Access

A user can use a sound they own, a public sound they added, and every sound of a public mix they
added — a playlist inside an added mix comes with the mix, like its sounds. Playlists hold no
playlists, so access goes one level deep and never chains.

- Item lookups return the item together with its relation to the user (`owner` or `added`);
  anything they cannot use is "not found", for their eyes as much as for a missing item.
- A **public mix may only hold public sounds and public playlists**, so everyone who adds it can
  play all of it.

## Added count

An item is served with a count of how many other users have it in their library, computed in the
same query that fetches the item. It only ever counts other accounts — nobody adds their own
item — so a newly created item reports zero, and unpublishing (which empties every library of
it) reports zero again. See how the app shows it in
`docs/apps/web-v2/library-and-sharing.md`.

## Pruning

Making an item private or deleting it takes it away from everyone else at once. A single
**prune** pass removes whatever no longer has access behind it, repeated until nothing changes:

- library entries of items now private;
- items of a **public** mix that are now private (sounds and playlists) — the mix stays public,
  the owner's own public mixes included;
- mix items, scene members, personal volumes and loops, and tags whose user can no longer use the
  item;
- synonyms no item carries anymore (categories stay until their owner deletes them).

## Per-user values

Helpers layer the viewer's own volumes and loop settings over an item they did not upload, and
resolve the owner's values (with the sound's length) for the editors.

## Images

- The images a user may put on their items are theirs and those of items they can use; an image
  is visible to whoever uploaded it, whoever has an item showing it, or when a public item shows
  it.
- An image no item shows anymore is deleted, row and file; before an account is deleted, other
  accounts' items that show its images are cleared so nothing points at a deleted file.
