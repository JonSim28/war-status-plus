# JSim War Station Plus

A Torn ranked-war panel for TornPDA.

- `war-status-plus.js` is the live script. Members' auto-updating loaders fetch it from
  `https://raw.githubusercontent.com/JonSim28/war-status-plus/main/war-status-plus.js`
  and pick up a new version within about 5 minutes.
- `src/war-status-plus.user.js` is the readable source it is built from.
- `src/loader.template.js` is the small loader each member installs once (made by the install page,
  with the faction's tracker and calls settings filled in; those are never stored here).

No API keys, passwords or tracker addresses are kept in this repository.
