FROM nginx:alpine

# Copy the HTML file to nginx default serving directory
COPY page.html /usr/share/nginx/html/index.html

# Create nginx config to serve the app and proxy API requests
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
