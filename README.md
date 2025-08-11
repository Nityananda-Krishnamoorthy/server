# 📱 NEXIS - Social Media Platform (Server)

This repository contains the **backend API** for **NEXIS**, a modern full-stack social media platform.  
The backend is built with **Node.js** and **Express**, using **MongoDB** for data storage, **JWT** for authentication, **Cloudinary** for media uploads, and **Socket.io** for real-time communication.

---

## 🚀 Features

- 🔑 **Secure Authentication & Authorization** using JWT  
- 📝 **Post Management** — Create, Read, Update, Delete posts  
- 🖼 **Media Uploads** with Multer + Cloudinary  
- 🔍 **Search & Explore** — Find users, posts, and trending tags  
- 📌 **Bookmarks** — Save posts for later  
- 🛡 **Privacy Controls** — Block users, private/public accounts  
- 💬 **Real-Time Chat** with Socket.io & Redis Adapter  
- 📊 **Trending Topics** algorithm  
- 🧩 **Scalable MVC Architecture** for maintainability  
- 🛡 **Security Enhancements** — Helmet, CORS, Rate Limiting  

---

## 🛠 Tech Stack

- **Backend Framework:** Node.js, Express  
- **Database:** MongoDB (Mongoose ORM)  
- **Authentication:** JWT, bcrypt.js  
- **File Uploads:** Multer, Cloudinary API  
- **Real-Time:** Socket.io, Redis, @socket.io/redis-adapter, ioredis  
- **Security:** Helmet, CORS, Express Rate Limit, dotenv  
- **Deployment:** Render / Railway / Vercel (serverless options)  

---

## ⚙️ Installation & Setup

### 1️⃣ Clone the Repository
```bash
git clone https://github.com/Nityananda-Krishnamoorthy/server.git
cd server
```

### 2️⃣ Install Dependencies
```bash
npm install
```
### 3️⃣ Environment Variables
```bash
Create a .env file in the root directory:

PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_jwt_secret
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
REDIS_URL=redis://localhost:6379

```

### 4️⃣ Run the Server
```bash
# Development
npm run dev

# Production
npm start
```

## 📦 Deployment

Frontend Repo: [client](https://github.com/Nityananda-Krishnamoorthy/client.git)

Backend Repo: [server](https://github.com/Nityananda-Krishnamoorthy/server.git)

Backend deployed on: [Render](https://server-6i3j.onrender.com)

Frontend deployed on: [Vercel](https://client-beige-ten-94.vercel.app/)

## 🤝 Contributing
```bash
Fork the repository

Create a feature branch (git checkout -b feature/your-feature)

Commit changes (git commit -m 'Add new feature')

Push to branch (git push origin feature/your-feature)

Create a Pull Request
```

## 📜 License
This project is licensed under the MIT License.
© 2025 Nityananda Krishnamoorthy

## 🙌 Credits
Inspired by modern social media platforms
Built with ❤️ by Nityananda Krishnamoorthy




