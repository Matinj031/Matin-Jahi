/**
 * gift-grid.js
 * Vanilla JS (no jQuery) controller for the "Tisso vison in the wild"
 * grid: opens the quick-view popup for a tile, builds its color/size
 * pickers from the product's real option data, resolves the matching
 * variant on every change, and adds it to the cart.
 *
 * Also implements the business rule: adding any product with a
 * Black + Medium variant automatically adds the "Soft Winter Jacket"
 * (configurable via the section's block settings) alongside it.
 */
(function () {
  'use strict';

  /** Root <section data-gift-grid> element. Bails out if the section isn't on the page. */
  var root = document.querySelector('[data-gift-grid]');
  if (!root) return;

  var bundleEnabled = root.dataset.bundleEnabled === 'true';
  var bundleVariantId = root.dataset.bundleVariantId;
  var bundleTriggerValues = (root.dataset.bundleTriggerOptions || '')
    .split(',')
    .map(function (value) { return value.trim().toLowerCase(); })
    .filter(Boolean);

  /**
   * Per-popup state: which value is currently picked for each option
   * index (0-based, matching product.options / variant.option1-3).
   * Keyed by the popup element itself via a WeakMap so nothing leaks
   * onto the DOM as extra attributes.
   */
  var popupState = new WeakMap();

  // ---------------------------------------------------------------------
  // Open / close
  // ---------------------------------------------------------------------

  function openPopup(popup, trigger) {
    popup.hidden = false;
    if (trigger) trigger.setAttribute('aria-expanded', 'true');
    popup.dataset.triggerId = trigger ? trigger.id || assignId(trigger) : '';
    document.body.style.overflow = 'hidden';

    var closeButton = popup.querySelector('.gift-popup__close');
    if (closeButton) closeButton.focus();
  }

  function closePopup(popup) {
    popup.hidden = true;
    document.body.style.overflow = '';

    var triggerId = popup.dataset.triggerId;
    var trigger = triggerId ? document.getElementById(triggerId) : null;
    if (trigger) {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.focus();
    }
  }

  function assignId(el) {
    var id = 'gift-hotspot-' + Math.random().toString(36).slice(2, 9);
    el.id = id;
    return id;
  }

  // ---------------------------------------------------------------------
  // Building the color / size pickers from product data
  // ---------------------------------------------------------------------

  /**
   * Reads data-options / data-variants off the popup, builds the option
   * UI, and applies the popup's current (or initial) variant selection.
   */
  function buildOptions(popup) {
    var optionsContainer = popup.querySelector('[data-popup-options]');
    var options = safeParseJSON(popup.dataset.options) || [];
    var variants = safeParseJSON(popup.dataset.variants) || [];
    // Ordered [{ name, color }] overrides from section settings. Entry N
    // overrides the DISPLAY label + chip color of the color option's Nth
    // value. The real option value is kept for variant resolution
    // (see gift-product-popup.liquid).
    var colorOverrides = safeParseJSON(popup.dataset.colorOverrides) || [];
    var addButton = popup.querySelector('[data-popup-add-to-cart]');
    var initialVariantId = addButton ? addButton.dataset.variantId : null;
    var initialVariant = variants.filter(function (v) {
      return String(v.id) === String(initialVariantId);
    })[0];

    var selected = (initialVariant
      ? [initialVariant.option1, initialVariant.option2, initialVariant.option3]
      : []
    ).slice(0, options.length);

    popupState.set(popup, {
      options: options,
      variants: variants,
      selected: selected,
      colorOverrides: colorOverrides,
    });

    optionsContainer.innerHTML = '';

    // Figure out which option is the "Color" one, matching by name. Only if
    // NO option is named color do we fall back to the first option. This is
    // computed once so a "Size" option that happens to be option1 is never
    // mistaken for the color swatch row.
    var colorIndex = resolveColorIndex(options);

    // Render Color first (as a swatch row), then Size/other options (as
    // dropdowns) below it — matching the Figma layout regardless of the
    // order Shopify returns the product options in.
    var ordered = options
      .map(function (option, index) { return { option: option, index: index }; })
      .sort(function (a, b) {
        var aRank = a.index === colorIndex ? 0 : 1;
        var bRank = b.index === colorIndex ? 0 : 1;
        return aRank - bRank;
      });

    ordered.forEach(function (entry) {
      var row = entry.index === colorIndex
        ? buildSwatchRow(popup, entry.option, entry.index)
        : buildDropdownRow(popup, entry.option, entry.index);
      optionsContainer.appendChild(row);
    });

    refreshAvailability(popup);
    resolveVariant(popup);
  }

  /**
   * Returns the index of the option that should render as the color swatch
   * row. Prefers an option literally named "Color"/"Colour"; only if none
   * match does it fall back to the first option.
   */
  function resolveColorIndex(options) {
    for (var i = 0; i < options.length; i++) {
      if (/colou?r/i.test(options[i].name || '')) return i;
    }
    return 0;
  }

  function buildSwatchRow(popup, option, index) {
    var state = popupState.get(popup);
    var wrapper = document.createElement('div');
    wrapper.className = 'gift-option';
    wrapper.dataset.optionIndex = index;

    var label = document.createElement('p');
    label.className = 'gift-option__label';
    label.textContent = option.name;
    wrapper.appendChild(label);

    var row = document.createElement('div');
    row.className = 'gift-option__swatches';

    option.values.forEach(function (value, valueIndex) {
      var override = state.colorOverrides[valueIndex] || {};

      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'gift-option__swatch';
      // Keep the product's REAL option value here so variant resolution still
      // works even when the admin renames the label below.
      button.dataset.value = value;
      button.setAttribute('aria-pressed', 'false');

      // Small color chip on the LEFT of the text (matches Figma), colored from
      // the admin's per-position override (falls back to a common color name).
      var chip = document.createElement('span');
      chip.className = 'gift-option__swatch-chip';
      chip.setAttribute('aria-hidden', 'true');
      chip.style.backgroundColor = resolveSwatchColor(override, value);
      button.appendChild(chip);

      // Show the admin-configured name when set, otherwise the real value.
      var displayName = (override.name && override.name.trim())
        ? override.name.trim()
        : value;
      var text = document.createElement('span');
      text.className = 'gift-option__swatch-text';
      text.textContent = displayName;
      button.appendChild(text);

      button.addEventListener('click', function () {
        selectOption(popup, index, value);
      });
      row.appendChild(button);
    });

    wrapper.appendChild(row);
    return wrapper;
  }

  function buildDropdownRow(popup, option, index) {
    var wrapper = document.createElement('div');
    wrapper.className = 'gift-option';
    wrapper.dataset.optionIndex = index;

    var label = document.createElement('p');
    label.className = 'gift-option__label';
    label.textContent = option.name;
    wrapper.appendChild(label);

    var dropdown = document.createElement('div');
    dropdown.className = 'gift-option__dropdown';
    dropdown.dataset.open = 'false';

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'gift-option__dropdown-trigger';
    trigger.innerHTML =
      '<span data-dropdown-label>Choose your ' + option.name.toLowerCase() + '</span>' +
      '<svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>';
    trigger.addEventListener('click', function () {
      var isOpen = dropdown.dataset.open === 'true';
      // Close any other open dropdowns in this popup first.
      popup.querySelectorAll('.gift-option__dropdown').forEach(function (d) {
        d.dataset.open = 'false';
      });
      dropdown.dataset.open = isOpen ? 'false' : 'true';
    });
    dropdown.appendChild(trigger);

    var list = document.createElement('div');
    list.className = 'gift-option__dropdown-list';
    option.values.forEach(function (value) {
      var item = document.createElement('button');
      item.type = 'button';
      item.className = 'gift-option__dropdown-item';
      item.textContent = value;
      item.dataset.value = value;
      item.setAttribute('aria-selected', 'false');
      item.addEventListener('click', function () {
        if (item.disabled) return;
        selectOption(popup, index, value);
        trigger.querySelector('[data-dropdown-label]').textContent = value;
        dropdown.dataset.open = 'false';
      });
      list.appendChild(item);
    });
    dropdown.appendChild(list);

    wrapper.appendChild(dropdown);
    return wrapper;
  }

  function selectOption(popup, index, value) {
    var state = popupState.get(popup);
    state.selected[index] = value;

    // Reflect the pressed/selected state visually.
    var optionsContainer = popup.querySelector('[data-popup-options]');
    var row = optionsContainer.querySelector('.gift-option[data-option-index="' + index + '"]');
    if (row) {
      row.querySelectorAll('[data-value]').forEach(function (el) {
        var isSelected = el.dataset.value === value;
        if (el.hasAttribute('aria-pressed')) el.setAttribute('aria-pressed', String(isSelected));
        if (el.hasAttribute('aria-selected')) el.setAttribute('aria-selected', String(isSelected));
      });
    }

    refreshAvailability(popup);
    resolveVariant(popup);
  }

  /**
   * Disables any option value that has no available variant given the
   * OTHER currently selected values (basic combination-availability check).
   */
  function refreshAvailability(popup) {
    var state = popupState.get(popup);
    var optionsContainer = popup.querySelector('[data-popup-options]');

    state.options.forEach(function (option, index) {
      var row = optionsContainer.querySelector('.gift-option[data-option-index="' + index + '"]');
      if (!row) return;

      row.querySelectorAll('[data-value]').forEach(function (el) {
        var candidate = state.selected.slice();
        candidate[index] = el.dataset.value;

        var hasAvailableMatch = state.variants.some(function (variant) {
          var variantValues = [variant.option1, variant.option2, variant.option3];
          var matchesKnown = candidate.every(function (val, i) {
            return val == null || variantValues[i] === val;
          });
          return matchesKnown && variant.available;
        });

        el.disabled = !hasAvailableMatch;
      });
    });
  }

  /**
   * Finds the variant matching the currently selected option values (if
   * every option has a value picked) and updates price / Add to Cart.
   */
  function resolveVariant(popup) {
    var state = popupState.get(popup);
    var addButton = popup.querySelector('[data-popup-add-to-cart]');
    var addLabel = popup.querySelector('[data-popup-add-label]');
    var priceEl = popup.querySelector('[data-popup-price]');
    var errorEl = popup.querySelector('[data-popup-error]');

    var allSelected = state.options.every(function (_, i) { return state.selected[i]; });
    if (!allSelected) {
      addButton.disabled = true;
      addLabel.textContent = 'Select options';
      addButton.removeAttribute('data-variant-id');
      errorEl.hidden = true;
      return;
    }

    var variant = state.variants.filter(function (v) {
      return (
        v.option1 === state.selected[0] &&
        (state.selected[1] == null || v.option2 === state.selected[1]) &&
        (state.selected[2] == null || v.option3 === state.selected[2])
      );
    })[0];

    if (!variant) {
      addButton.disabled = true;
      addLabel.textContent = 'Unavailable';
      addButton.removeAttribute('data-variant-id');
      return;
    }

    if (priceEl) priceEl.textContent = formatMoney(variant.price);
    addButton.dataset.variantId = variant.id;
    addButton.disabled = !variant.available;
    addLabel.textContent = variant.available ? 'Add to cart' : 'Sold out';
    errorEl.hidden = true;
  }

  // ---------------------------------------------------------------------
  // Add to cart (+ Soft Winter Jacket bundle rule)
  // ---------------------------------------------------------------------

  function handleAddToCart(popup) {
    var addButton = popup.querySelector('[data-popup-add-to-cart]');
    var addLabel = popup.querySelector('[data-popup-add-label]');
    var errorEl = popup.querySelector('[data-popup-error]');
    var state = popupState.get(popup);
    var variantId = addButton.dataset.variantId;

    if (!variantId) {
      errorEl.hidden = false;
      return;
    }

    addButton.setAttribute('data-state', 'adding');
    addButton.disabled = true;
    var originalLabel = addLabel.textContent;
    addLabel.textContent = 'Adding...';

    var items = [{ id: Number(variantId), quantity: 1 }];

    // Business rule: Black + Medium on the item being added also adds
    // the configured bundle product (e.g. "Soft Winter Jacket").
    if (bundleEnabled && bundleVariantId && bundleTriggerValues.length) {
      var selectedLower = state.selected.map(function (v) {
        return (v || '').toLowerCase();
      });
      var triggersAllMatch = bundleTriggerValues.every(function (needed) {
        return selectedLower.indexOf(needed) !== -1;
      });
      if (triggersAllMatch) {
        items.push({ id: Number(bundleVariantId), quantity: 1 });
      }
    }

    fetch(window.Shopify && window.Shopify.routes && window.Shopify.routes.root
      ? window.Shopify.routes.root + 'cart/add.js'
      : '/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ items: items }),
    })
      .then(function (response) {
        if (!response.ok) return response.json().then(function (err) { throw err; });
        return response.json();
      })
      .then(function () {
        addLabel.textContent = 'Added!';
        refreshCartCount();
        window.setTimeout(function () {
          addButton.removeAttribute('data-state');
          addButton.disabled = false;
          addLabel.textContent = originalLabel;
          closePopup(popup);
        }, 900);
      })
      .catch(function (err) {
        console.error('Gift grid: add to cart failed', err);
        addButton.removeAttribute('data-state');
        addButton.disabled = false;
        addLabel.textContent = originalLabel;
        errorEl.textContent = (err && err.description) || 'Could not add to cart. Please try again.';
        errorEl.hidden = false;
      });
  }

  /**
   * Refreshes any standard Dawn cart-count bubble on the page and lets
   * other scripts (cart drawer, etc.) know the cart changed. Written
   * defensively since we don't want a missing element to throw.
   */
  function refreshCartCount() {
    fetch('/cart.js')
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        document.querySelectorAll('.cart-count-bubble, [data-cart-count]').forEach(function (el) {
          el.textContent = cart.item_count;
        });
        document.dispatchEvent(new CustomEvent('cart:refresh', { detail: cart, bubbles: true }));
      })
      .catch(function (err) {
        console.error('Gift grid: could not refresh cart count', err);
      });
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function safeParseJSON(str) {
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch (err) {
      console.error('Gift grid: invalid JSON on popup element', err);
      return null;
    }
  }

  function formatMoney(cents) {
    return '€' + (cents / 100).toFixed(2).replace('.', ',');
  }

  var COLOR_FALLBACK = {
    black: '#000000', white: '#ffffff', blue: '#0d499f', navy: '#1c2b4a',
    red: '#b3261e', grey: '#808080', gray: '#808080', green: '#2f5233',
    pink: '#e8a0bf', orange: '#d2691e', yellow: '#fff544', beige: '#e8dcc8',
    brown: '#6b4423',
  };

  /**
   * Resolves a swatch color. Prefers the admin's per-position override color
   * from section settings; falls back to a few common color names (keyed off
   * the real value) only if no override color is set.
   */
  function resolveSwatchColor(override, value) {
    if (override && override.color) return override.color;
    var key = (value || '').toLowerCase().trim();
    return COLOR_FALLBACK[key] || '#000000';
  }

  // ---------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------

  document.querySelectorAll('[data-gift-popup]').forEach(function (popup) {
    buildOptions(popup);

    popup.querySelectorAll('[data-popup-close]').forEach(function (btn) {
      btn.addEventListener('click', function () { closePopup(popup); });
    });

    var addButton = popup.querySelector('[data-popup-add-to-cart]');
    if (addButton) {
      addButton.addEventListener('click', function () { handleAddToCart(popup); });
    }
  });

  root.querySelectorAll('[data-popup-trigger]').forEach(function (trigger) {
    trigger.addEventListener('click', function () {
      var popup = document.getElementById(trigger.dataset.popupTrigger);
      if (popup) openPopup(popup, trigger);
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var openPopupEl = root.querySelector('[data-gift-popup]:not([hidden])');
    if (openPopupEl) closePopup(openPopupEl);
  });

  // Close any open size dropdown when clicking outside of it.
  document.addEventListener('click', function (event) {
    document.querySelectorAll('.gift-option__dropdown[data-open="true"]').forEach(function (dropdown) {
      if (!dropdown.contains(event.target)) dropdown.dataset.open = 'false';
    });
  });
})();
