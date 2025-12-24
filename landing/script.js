/**
 * NatePay Landing Page Scripts
 * - Hero demo animation
 * - Scroll reveal animations
 * - Mobile menu toggle
 * - Navbar scroll behavior
 */

(function() {
  'use strict';

  // Wait for DOM
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    initHeroDemo();
    initScrollReveal();
    initMobileMenu();
    initNavbarScroll();
    initSmoothScroll();
  }


  /**
   * Hero Demo Animation
   * Automatically plays through payment states
   */
  function initHeroDemo() {
    const demo = document.querySelector('.hero-demo');
    if (!demo) return;

    // Add auto-animate class for initial load
    demo.classList.add('auto-animate');

    // Timeline: Wait 1s, then complete
    setTimeout(() => {
      demo.classList.add('complete');
    }, 1000);

    // Allow click to replay
    const button = demo.querySelector('.demo-apple-pay');
    if (button) {
      button.addEventListener('click', () => {
        // Reset
        demo.classList.remove('complete', 'auto-animate');

        // Force reflow
        void demo.offsetWidth;

        // Add processing state
        demo.classList.add('processing');

        // After 1s, show complete
        setTimeout(() => {
          demo.classList.remove('processing');
          demo.classList.add('complete');
        }, 1000);
      });
    }
  }


  /**
   * Scroll Reveal Animation
   * Fade in elements as they enter viewport
   * Supports multiple animation types: reveal, reveal-left, reveal-right, reveal-scale, reveal-stagger
   */
  function initScrollReveal() {
    const revealClasses = ['.reveal', '.reveal-left', '.reveal-right', '.reveal-scale', '.reveal-stagger'];
    const reveals = document.querySelectorAll(revealClasses.join(', '));

    if (!reveals.length) return;

    // Use IntersectionObserver for performance
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          // Unobserve after revealing (animation plays once)
          observer.unobserve(entry.target);
        }
      });
    }, {
      root: null,
      rootMargin: '0px 0px -60px 0px', // Trigger slightly before fully in view
      threshold: 0.1
    });

    reveals.forEach(el => observer.observe(el));
  }


  /**
   * Mobile Menu Toggle
   */
  function initMobileMenu() {
    const toggle = document.getElementById('nav-toggle');
    const menu = document.getElementById('mobile-menu');

    if (!toggle || !menu) return;

    toggle.addEventListener('click', () => {
      toggle.classList.toggle('active');
      menu.classList.toggle('open');
      document.body.style.overflow = menu.classList.contains('open') ? 'hidden' : '';
    });

    // Close menu when clicking a link
    menu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        toggle.classList.remove('active');
        menu.classList.remove('open');
        document.body.style.overflow = '';
      });
    });

    // Close menu on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('open')) {
        toggle.classList.remove('active');
        menu.classList.remove('open');
        document.body.style.overflow = '';
      }
    });
  }


  /**
   * Navbar Scroll Behavior
   * Hide on scroll down, show on scroll up
   */
  function initNavbarScroll() {
    const nav = document.getElementById('nav');
    if (!nav) return;

    let lastScrollY = window.scrollY;
    let ticking = false;

    function updateNav() {
      const currentScrollY = window.scrollY;

      // Add background blur after scrolling past hero
      if (currentScrollY > 100) {
        nav.style.background = 'rgba(255, 255, 255, 0.9)';
      } else {
        nav.style.background = 'rgba(255, 255, 255, 0.85)';
      }

      // Hide/show on scroll direction
      if (currentScrollY > lastScrollY && currentScrollY > 200) {
        // Scrolling down & past threshold
        nav.classList.add('hidden');
      } else {
        // Scrolling up
        nav.classList.remove('hidden');
      }

      lastScrollY = currentScrollY;
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) {
        window.requestAnimationFrame(updateNav);
        ticking = true;
      }
    }, { passive: true });
  }


  /**
   * Smooth Scroll for Anchor Links
   */
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        const targetId = this.getAttribute('href');
        if (targetId === '#') return;

        const target = document.querySelector(targetId);
        if (!target) return;

        e.preventDefault();

        const navHeight = document.getElementById('nav')?.offsetHeight || 72;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - navHeight;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      });
    });
  }

})();
