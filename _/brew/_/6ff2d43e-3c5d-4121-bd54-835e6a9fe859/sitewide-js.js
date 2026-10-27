// Local offline compatibility shim for the archived Keybase profile snapshot.
class Session {
  constructor() { this.startedAt = Date.now(); }
  start() { return this; }
  stop() { return this; }
}
window.Session = Session;
