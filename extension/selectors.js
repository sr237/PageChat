globalThis.PAGECHAT_SELECTORS = {
  amazon: {
    title: "#productTitle", price: ".a-price .a-offscreen", rating: "#acrCustomerReviewText",
    bullets: "#feature-bullets li",
    reviewCard: '[data-hook="review"]',
    reviewText: '[data-hook="review-body"], [data-hook="review-collapsed"], .review-text-content',
    reviewRating: '[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt',
    reviews: '[data-hook="review-body"], [data-hook="review-collapsed"], .review-text-content',
    addToCart: "#add-to-cart-button"
  },
  flipkart: {
    // Flipkart selectors change often; recheck these when extraction stops matching.
    title: "span.B_NuCI, h1", price: "div._30jeq3, div.Nx9bqj", rating: "div._3LWZlK, div.XQDdHH",
    bullets: "div._1mXcCf li, div._2418kt li", specs: "table tr, div._3k-BhJ",
    reviews: "div.t-ZTKy, div._6K-7Co", addToCart: "button._2KpZ6l"
  },
  imdb: {
    title: "h1[data-testid='hero__pageTitle']", rating: "[data-testid='hero-rating-bar__aggregate-rating__score']",
    synopsis: "[data-testid='plot']", reviews: "[data-testid='review-card']",
    criticScore: "[data-testid='metacritic-score-item']"
  }
};
