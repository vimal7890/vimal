/* vimal.my — the name in the site header cross-fades between its Latin and
   Tamil spellings. Runs on every page; static under reduced motion, and
   paused while the tab is hidden. */
(function () {
    var name = document.querySelector('.site-name');
    if (!name || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var spellings = ['Vimal', 'விமல்'];
    var index = 0;
    var timer = null;

    function start() {
        if (timer) return;
        timer = setInterval(function () {
            name.classList.add('fade');
            setTimeout(function () {
                index = (index + 1) % spellings.length;
                name.textContent = spellings[index];
                name.lang = index === 1 ? 'ta' : 'en';
                name.classList.remove('fade');
            }, 500);
        }, 2000);
    }

    start();
    document.addEventListener('visibilitychange', function () {
        clearInterval(timer);
        timer = null;
        if (document.visibilityState === 'visible') start();
    });
})();
