# Use the official Node.js image
FROM node:18

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json (if any)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the entire server code
COPY . .

# Expose the backend port (make sure it matches your server port)
EXPOSE 3456

# Run the server using production command
CMD ["npm", "run", "dev"]

