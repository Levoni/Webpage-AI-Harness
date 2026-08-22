FROM nginx:alpine

# Copy the HTML files and shared config to the nginx serving directory
COPY login.html /usr/share/nginx/html/index.html
COPY page.html /usr/share/nginx/html/page.html
COPY login.html /usr/share/nginx/html/login.html
COPY api-config.js /usr/share/nginx/html/api-config.js

# Create nginx config to serve the app and proxy API requests
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
