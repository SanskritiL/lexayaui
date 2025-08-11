document.addEventListener('DOMContentLoaded', function() {
    const searchInput = document.querySelector('.search-input');
    const searchBtn = document.querySelector('.search-btn');
    const suggestionTags = document.querySelectorAll('.suggestion-tag');
    const categoryCards = document.querySelectorAll('.category-card');

    // Search functionality
    function performSearch() {
        const query = searchInput.value.trim();
        if (query) {
            console.log('Searching for:', query);
            // Here you would integrate with your actual search API
            alert(`Searching for: ${query}\n\nThis would redirect to search results page in a real application.`);
        }
    }

    // Search button click
    searchBtn.addEventListener('click', performSearch);

    // Enter key in search input
    searchInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') {
            performSearch();
        }
    });

    // Suggestion tag clicks
    suggestionTags.forEach(tag => {
        tag.addEventListener('click', function() {
            searchInput.value = this.textContent;
            performSearch();
        });
    });

    // Category card clicks
    categoryCards.forEach(card => {
        card.addEventListener('click', function() {
            const category = this.querySelector('h3').textContent;
            console.log('Category selected:', category);
            alert(`Browsing ${category} category\n\nThis would show ${category.toLowerCase()} products in a real application.`);
        });
    });

    // Smooth scrolling for navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Add search input focus animations
    searchInput.addEventListener('focus', function() {
        this.parentElement.style.transform = 'scale(1.02)';
        this.parentElement.style.boxShadow = '0 25px 50px rgba(0,0,0,0.15)';
    });

    searchInput.addEventListener('blur', function() {
        this.parentElement.style.transform = 'scale(1)';
        this.parentElement.style.boxShadow = '0 20px 40px rgba(0,0,0,0.1)';
    });

    // Navbar background change on scroll
    window.addEventListener('scroll', function() {
        const navbar = document.querySelector('.navbar');
        if (window.scrollY > 50) {
            navbar.style.background = 'rgba(255, 255, 255, 0.95)';
            navbar.style.backdropFilter = 'blur(10px)';
        } else {
            navbar.style.background = 'white';
            navbar.style.backdropFilter = 'none';
        }
    });

    // Add loading animation for search
    function showSearchLoading() {
        searchBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        searchBtn.disabled = true;
        
        setTimeout(() => {
            searchBtn.innerHTML = 'Search';
            searchBtn.disabled = false;
        }, 2000);
    }

    // Intersection Observer for animations
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }
        });
    }, observerOptions);

    // Observe elements for animation
    document.querySelectorAll('.feature-card, .category-card').forEach(card => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(30px)';
        card.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
        observer.observe(card);
    });
});

// Waitlist functionality
function joinWaitlist() {
    const subject = 'Join Lexaya Waitlist';
    const body = `Hi Lexaya team,\n\nI'm interested in joining your waitlist for early access to your shopping search platform.\n\nI'm excited to stop wasting time shopping and would love to be notified when you launch.\n\nBest regards,\n[Your Name]`;
    
    const mailtoLink = `mailto:hello@lexaya.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    
    window.open(mailtoLink);
}