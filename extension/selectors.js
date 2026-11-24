globalThis.PAGECHAT_SELECTORS = {
  amazon: {
    title: "#productTitle", price: ".a-price .a-offscreen", rating: "#acrCustomerReviewText",
    bullets: "#feature-bullets li", reviews: '[data-hook="review-body"]',
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
