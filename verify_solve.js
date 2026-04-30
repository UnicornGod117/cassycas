const math = require('mathjs');
// Let's verify that `evalSolve` actually works inside CAS (new).html.
// Oh wait, my patch DID modify `CAS (new).html` to use 20000 steps for `findRoots`.
// Let's run playwright again to see if it output correctly.
