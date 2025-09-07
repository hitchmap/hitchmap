# Use a minimal Python image
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && \
    apt-get install -y curl build-essential && \
    rm -rf /var/lib/apt/lists/*

# Install Node.js (LTS)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Set work directory
WORKDIR /app

# Copy Python requirements and install
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy package.json and install Node dependencies
COPY package.json ./
RUN npm install

# Copy the rest of the code
COPY . .

# Build frontend (if needed)
RUN npm run build

RUN curl -fsSL https://hitchmap.com/dump.sqlite -o db/points.sqlite

# Expose port (adjust if your server uses a different port)
EXPOSE 5000

# Default command (can be changed to run scripts/show.py or server.py)
RUN ["python", "scripts/show.py"]
CMD ["python", "server.py"]