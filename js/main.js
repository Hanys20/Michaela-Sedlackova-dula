document.addEventListener('DOMContentLoaded', () => {

  /* ─── ROK VE FOOTERU ─── */
  const yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ─── NAVBAR: shadow on scroll ─── */
  const navbar = document.getElementById('navbar');
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 20);
  }, { passive: true });


  /* ─── HAMBURGER MENU ─── */
  const hamburger = document.getElementById('hamburger');
  const mobileMenu = document.getElementById('mobile-menu');

  hamburger.addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('open');
    hamburger.classList.toggle('open', open);
    hamburger.setAttribute('aria-expanded', open);
  });

  mobileMenu.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => {
      mobileMenu.classList.remove('open');
      hamburger.classList.remove('open');
    });
  });


  /* ─── ČÍST VÍCE – servisní položky (globální, mimo carousel) ─── */
  document.querySelectorAll('.service-item .read-more').forEach(btn => {
    btn.addEventListener('click', () => {
      const content = document.getElementById(btn.dataset.target);
      if (!content) return;
      const isOpen = content.classList.toggle('open');
      btn.textContent = isOpen ? '↑ skrýt' : '↓ číst více';
    });
  });

  /* ─── ČÍST VÍCE – recenze (synchronizované na všech kartách naráz) ─── */
  const reviewExtras = Array.from(document.querySelectorAll('.review-extra'));
  const reviewBtns   = Array.from(document.querySelectorAll('.review-card .read-more'));

  reviewBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const shouldOpen = !reviewExtras[0].classList.contains('open');
      reviewExtras.forEach(el => el.classList.toggle('open', shouldOpen));
      reviewBtns.forEach(b => { b.textContent = shouldOpen ? '↑ skrýt' : '↓ číst více'; });
    });
  });


  /* ─── SCROLL-SPY: active nav link ─── */
  const sections  = document.querySelectorAll('section[id], .hero[id]');
  const navLinks  = document.querySelectorAll('.nav-links a, .mobile-menu a');

  const setActive = (id) => {
    navLinks.forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
    });
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) setActive(entry.target.id);
    });
  }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });

  sections.forEach(s => observer.observe(s));


  /* ─── RECENZE CAROUSEL – responsivní (1 karta mobil / 3 desktop) ─── */
  const carouselTrack = document.querySelector('.carousel-track');
  if (carouselTrack) {
    const dotsContainer = document.getElementById('carousel-dots');
    const prevBtn  = document.querySelector('.carousel-prev');
    const nextBtn  = document.querySelector('.carousel-next');
    const cards    = Array.from(carouselTrack.children);
    const total    = cards.length;
    let currentPage = 0;
    let autoTimer;
    let resizeTimer;

    const getPerPage      = () => window.innerWidth >= 1025 ? 3 : window.innerWidth >= 768 ? 2 : 1;
    const getTotalSteps   = () => total - getPerPage() + 1; /* posouvá po 1 kartě */

    const buildDots = () => {
      const steps = getTotalSteps();
      dotsContainer.innerHTML = Array.from({length: steps}, (_, i) =>
        `<button class="carousel-dot${i === 0 ? ' active' : ''}" aria-label="Recenze ${i + 1}"></button>`
      ).join('');
      dotsContainer.querySelectorAll('.carousel-dot').forEach((dot, i) => {
        dot.addEventListener('click', () => { goTo(i); resetAuto(); });
      });
    };

    const updateDots = () => {
      dotsContainer.querySelectorAll('.carousel-dot').forEach((d, i) =>
        d.classList.toggle('active', i === currentPage)
      );
    };

    const getOffset = (page) => {
      const gap  = parseFloat(getComputedStyle(carouselTrack).columnGap) || 0;
      const cardW = cards[0].getBoundingClientRect().width;
      return page * (cardW + gap); /* 1 karta na krok */
    };

    const goTo = (page) => {
      const steps = getTotalSteps();
      currentPage = (page + steps) % steps;
      carouselTrack.style.transform = `translateX(-${getOffset(currentPage)}px)`;
      updateDots();
    };

    const init = () => {
      currentPage = 0;
      buildDots();
      carouselTrack.style.transform = 'translateX(0)';
    };

    const resetAuto = () => {
      clearInterval(autoTimer);
      autoTimer = setInterval(() => goTo(currentPage + 1), 6000);
    };

    prevBtn.addEventListener('click', () => { goTo(currentPage - 1); resetAuto(); });
    nextBtn.addEventListener('click', () => { goTo(currentPage + 1); resetAuto(); });
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(init, 150);
    });

    init();
    resetAuto();
  }


  /* ─── KONTAKTNÍ FORMULÁŘ: základní validace ─── */
  const form = document.querySelector('.contact-form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const jmeno = form.querySelector('#jmeno').value.trim();
      const email = form.querySelector('#email').value.trim();
      if (!jmeno || !email) {
        alert('Vyplňte prosím jméno a e-mail.');
        return;
      }
      /* TODO: napojit na backend / Formspree / EmailJS */
      alert('Děkuji za zprávu! Ozvu se vám co nejdříve.');
      form.reset();
    });
  }


  /* ─── SCROLL REVEAL ─── */
  const reveal = (sel, cls, staggerMs) => {
    document.querySelectorAll(sel).forEach((el, i) => {
      el.classList.add(cls);
      if (staggerMs) el.style.transitionDelay = (i * staggerMs) + 'ms';
    });
  };

  reveal('.section-header', 'sr');
  reveal('.pillar-card', 'sr', 120);
  reveal('.cenik-group', 'sr', 100);
  reveal('.cert-badge', 'sr', 80);
  reveal('.about-img-wrap', 'sr-left');
  reveal('.about-text', 'sr-right');
  reveal('.contact-grid', 'sr');

  const srObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('sr-vis'); srObs.unobserve(e.target); }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  document.querySelectorAll('.sr, .sr-left, .sr-right').forEach(el => srObs.observe(el));


  /* ─── SP NUMBER COUNTER ─── */
  const spNumbers = document.querySelectorAll('.sp-number');
  const spObs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el = e.target;
      const raw = el.textContent.trim();
      const num = parseInt(raw.replace(/\D/g, ''), 10);
      const suffix = raw.replace(/[0-9]/g, '');
      if (isNaN(num)) return;
      const sfxHtml = suffix ? `<span class="sp-sfx">${suffix}</span>` : '';
      const duration = 2400;
      const t0 = performance.now();
      const tick = now => {
        const p = Math.min((now - t0) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.innerHTML = Math.round(eased * num) + sfxHtml;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      spObs.unobserve(el);
    });
  }, { threshold: 0.6 });
  spNumbers.forEach(el => spObs.observe(el));

});
