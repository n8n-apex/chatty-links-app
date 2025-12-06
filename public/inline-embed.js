(function() {
  // Get the current script element
  var script = document.currentScript;
  
  // Get configuration from data attributes
  var height = script.getAttribute('data-height') || '600px';
  var width = script.getAttribute('data-width') || '100%';
  var baseUrl = script.src.replace('/inline-embed.js', '');
  
  // Create container
  var container = document.createElement('div');
  container.style.cssText = 'width: ' + width + '; height: ' + height + '; max-width: 100%; margin: 0 auto;';
  
  // Create iframe
  var iframe = document.createElement('iframe');
  iframe.src = baseUrl;
  iframe.style.cssText = 'width: 100%; height: 100%; border: none; border-radius: 12px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);';
  iframe.allow = 'clipboard-write';
  iframe.title = 'APEX AI Assistant';
  
  // Append iframe to container
  container.appendChild(iframe);
  
  // Insert container after the script tag
  script.parentNode.insertBefore(container, script.nextSibling);
})();
