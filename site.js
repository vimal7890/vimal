/* vimal.my — the name in the site header cross-fades between its Latin and
   Tamil spellings. Runs on every page; static under reduced motion, and
   paused while the tab is hidden.

   The cycle is timed against a start time kept in sessionStorage, so moving
   between pages picks the animation up mid-cycle instead of restarting it. */
(function () {
    var name = document.querySelector('.site-name');
    if (!name || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var spellings = ['Vimal', 'விமல்'];
    var SLOT = 2000;   // ms each spelling holds, fade-out included
    var FADE = 500;    // ms the fade-out takes (matches the CSS transition)
    var KEY = 'site-name-epoch';
    var timer = null;

    var epoch = Date.now();
    try {
        var stored = Number(sessionStorage.getItem(KEY));
        if (stored > 0 && stored <= epoch) {
            epoch = stored;
        } else {
            sessionStorage.setItem(KEY, String(epoch));
        }
    } catch (e) { /* storage unavailable: run from this page's own clock */ }

    function show(index) {
        name.textContent = spellings[index];
        name.lang = index === 1 ? 'ta' : 'en';
        name.classList.remove('fade');
    }

    /* Show whichever spelling the shared clock says is current, then line the
       next fade up on the same clock. */
    function sync() {
        var elapsed = Date.now() - epoch;
        var slot = Math.floor(elapsed / SLOT);
        var fadeAt = (slot + 1) * SLOT - FADE;
        if (elapsed >= fadeAt) {           // mid-fade: the next spelling is due
            slot += 1;
            fadeAt += SLOT;
        }
        show(slot % spellings.length);
        timer = setTimeout(function () {
            name.classList.add('fade');
            timer = setTimeout(sync, FADE);
        }, fadeAt - elapsed);
    }

    function stop() {
        clearTimeout(timer);
        timer = null;
    }

    sync();
    document.addEventListener('visibilitychange', function () {
        stop();
        if (document.visibilityState === 'visible') sync();
    });
})();
