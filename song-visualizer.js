/* Decorative "audio rail" canvases beside the Spotify embeds (homepage and
   Song of the Month archive).

   - Animates only while a widget is on screen and the tab is visible.
   - Draws a single static frame when the user prefers reduced motion.
   - Brightens on hover/focus. A page with a real playback controller can call
     SongVisualizer.setPlayback(shellElement, { isPlaying, position, duration })
     to make the rails react to the music. */
(function () {
    'use strict';

    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
    var items = [];
    var frame = 0;
    var visibleCount = 0;

    function noise(seed) {
        var value = Math.sin(seed * 12.9898) * 43758.5453;
        return value - Math.floor(value);
    }

    function findItem(shell) {
        for (var i = 0; i < items.length; i++) {
            if (items[i].shell === shell) return items[i];
        }
        return null;
    }

    function build(shell, index) {
        var canvases = shell.querySelectorAll('.song-visualizer');
        if (canvases.length < 2) return null;

        var rails = [];
        for (var i = 0; i < canvases.length; i++) {
            var ctx = canvases[i].getContext('2d');
            if (!ctx) return null;
            rails.push({ canvas: canvases[i], ctx: ctx, direction: i === 0 ? -1 : 1 });
        }

        return {
            shell: shell,
            rails: rails,
            energy: 0.12,
            target: 0.12,
            rest: 0.12,
            hover: 0.42,
            progress: 0,
            playing: false,
            phase: index * 0.9,
            visible: false
        };
    }

    function resize(item) {
        var ratio = window.devicePixelRatio || 1;
        item.rails.forEach(function (rail) {
            var width = Math.max(1, Math.floor(rail.canvas.clientWidth || 32));
            var height = Math.max(1, Math.floor(rail.canvas.clientHeight || 152));
            rail.canvas.width = Math.max(1, Math.floor(width * ratio));
            rail.canvas.height = Math.max(1, Math.floor(height * ratio));
            rail.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            rail.ctx.lineCap = 'round';
        });
    }

    function drawRail(item, rail, t) {
        var ctx = rail.ctx;
        var width = rail.canvas.clientWidth;
        var height = rail.canvas.clientHeight;
        if (!width || !height) return;

        ctx.clearRect(0, 0, width, height);

        var lanes = Math.max(14, Math.round(height / 18));
        var gap = height / lanes;
        var edge = rail.direction < 0 ? width - 1 : 1;
        var maxReach = Math.max(6, width - 5);
        var color = darkQuery.matches ? '240, 84, 79' : '158, 59, 47';

        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(' + color + ', ' + (item.playing ? 0.16 : 0.08) + ')';
        ctx.beginPath();
        ctx.moveTo(edge, 0);
        ctx.lineTo(edge, height);
        ctx.stroke();

        ctx.lineWidth = 1.15;
        for (var i = 0; i < lanes; i++) {
            var ratio = i / Math.max(1, lanes - 1);
            var wave = 0.5 + 0.5 * Math.sin(t * 4.6 + item.phase + ratio * 10.5 + item.progress * 18);
            var shimmer = 0.5 + 0.5 * Math.sin(t * 8.4 + ratio * 19.5 + rail.direction * 0.8);
            var grain = noise(ratio * 80 + t * 2.1 + item.progress * 160 + item.phase * 10);
            var pulse = wave * 0.46 + shimmer * 0.34 + grain * 0.2;
            var magnitude = 1.5 + (maxReach - 1.5) * pulse * (0.2 + item.energy * 0.52);
            var alpha = 0.1 + pulse * (item.playing ? 0.3 : 0.12) + item.energy * 0.04;
            var y = i * gap + gap / 2;

            ctx.strokeStyle = 'rgba(' + color + ', ' + alpha.toFixed(3) + ')';
            ctx.beginPath();
            ctx.moveTo(edge, y);
            ctx.lineTo(rail.direction < 0 ? edge - magnitude : edge + magnitude, y);
            ctx.stroke();
        }
    }

    function tick() {
        frame = 0;
        var t = performance.now() * 0.001;
        items.forEach(function (item) {
            if (!item.visible) return;
            item.energy += (item.target - item.energy) * 0.08;
            item.rails.forEach(function (rail) { drawRail(item, rail, t); });
        });
        if (!reduceMotion && visibleCount > 0 && document.visibilityState !== 'hidden') {
            schedule();
        }
    }

    function schedule() {
        if (!frame) frame = window.requestAnimationFrame(tick);
    }

    function setActive(item, on) {
        item.rails.forEach(function (rail) { rail.canvas.classList.toggle('active', on); });
    }

    window.SongVisualizer = {
        setPlayback: function (shell, state) {
            var item = findItem(shell);
            if (!item) return;
            var playing = Boolean(state && state.isPlaying);
            if (state && state.duration > 0) {
                item.progress = Math.max(0, Math.min(1, (state.position || 0) / state.duration));
            }
            item.playing = playing;
            item.target = playing ? 0.98 : item.rest;
            setActive(item, playing);
            schedule();
        },
        refresh: function () {
            items.forEach(resize);
            schedule();
        }
    };

    function init() {
        var shells = document.querySelectorAll('.song-widget-shell');
        for (var i = 0; i < shells.length; i++) {
            var item = build(shells[i], i);
            if (item) items.push(item);
        }
        if (!items.length) return;

        items.forEach(function (item) {
            resize(item);
            var boost = function () {
                if (!item.playing) item.target = item.hover;
                schedule();
            };
            var calm = function () {
                if (!item.playing) item.target = item.rest;
                schedule();
            };
            item.shell.addEventListener('mouseenter', boost);
            item.shell.addEventListener('mouseleave', calm);
            item.shell.addEventListener('focusin', boost);
            item.shell.addEventListener('focusout', calm);
        });

        if ('IntersectionObserver' in window) {
            var observer = new IntersectionObserver(function (entries) {
                entries.forEach(function (entry) {
                    var item = findItem(entry.target);
                    if (!item || item.visible === entry.isIntersecting) return;
                    item.visible = entry.isIntersecting;
                    visibleCount += entry.isIntersecting ? 1 : -1;
                });
                if (visibleCount > 0) schedule();
            }, { rootMargin: '80px' });
            items.forEach(function (item) { observer.observe(item.shell); });
        } else {
            items.forEach(function (item) { item.visible = true; });
            visibleCount = items.length;
        }

        if ('ResizeObserver' in window) {
            var resizer = new ResizeObserver(function () {
                items.forEach(resize);
                schedule();
            });
            items.forEach(function (item) { resizer.observe(item.shell); });
        } else {
            window.addEventListener('resize', window.SongVisualizer.refresh);
        }

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') schedule();
        });
        if (typeof darkQuery.addEventListener === 'function') {
            darkQuery.addEventListener('change', schedule);
        }

        schedule();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
