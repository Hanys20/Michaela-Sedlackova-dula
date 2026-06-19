(function(){
  var outer = document.querySelector('.sp-car-outer');
  if (!outer) return;
  var car = outer.querySelector('.sp-carousel');
  var track = outer.querySelector('.sp-carousel-track');
  var imgs = track.querySelectorAll('img');
  var total = imgs.length;
  var dots = outer.querySelectorAll('.sp-car-dot');
  var cur = 0;
  var GAP = 4;

  function getVisible() {
    return window.innerWidth >= 1024 ? 4 : 3;
  }

  function getSlideW() {
    var vis = getVisible();
    var cw = car.offsetWidth;
    return (cw - (vis - 1) * GAP) / vis;
  }

  function setup() {
    var w = getSlideW();
    imgs.forEach(function(img) { img.style.width = w + 'px'; });
  }

  function updateDots() {
    var vis = getVisible();
    var max = total - vis;
    dots.forEach(function(d, i) {
      d.style.display = i <= max ? '' : 'none';
      d.classList.toggle('active', i === cur);
    });
  }

  function go(n) {
    var vis = getVisible();
    var max = total - vis;
    cur = Math.max(0, Math.min(n, max));
    var step = getSlideW() + GAP;
    track.style.transform = 'translateX(-' + (cur * step) + 'px)';
    updateDots();
  }

  setup();
  updateDots();

  outer.querySelector('.sp-car-prev').addEventListener('click', function() { go(cur - 1); });
  outer.querySelector('.sp-car-next').addEventListener('click', function() { go(cur + 1); });
  dots.forEach(function(d, i) { d.addEventListener('click', function() { go(i); }); });

  var timer = setInterval(function() {
    var vis = getVisible();
    go(cur + 1 > total - vis ? 0 : cur + 1);
  }, 4500);

  car.addEventListener('mouseenter', function() { clearInterval(timer); });
  car.addEventListener('mouseleave', function() {
    timer = setInterval(function() {
      var vis = getVisible();
      go(cur + 1 > total - vis ? 0 : cur + 1);
    }, 4500);
  });

  var sx = 0;
  track.addEventListener('touchstart', function(e) { sx = e.touches[0].clientX; }, {passive: true});
  track.addEventListener('touchend', function(e) {
    var dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 40) go(dx < 0 ? cur + 1 : cur - 1);
  }, {passive: true});

  window.addEventListener('resize', function() { setup(); go(0); });
})();
