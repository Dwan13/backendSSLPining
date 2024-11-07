import express, { Application } from 'express';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { gql } from 'graphql-tag';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { createClient } from 'redis';
import cors from 'cors';
import bodyParser from 'body-parser';
import https from 'https';
import fs from 'fs';

const SECRET_KEY = 'f956f15ef3b1e6022775dc9978693560ae8d3f667b38efecd93a796230533271'; // Cambiar en producción
const redisClient = createClient();

redisClient.on('error', (err) => console.log('Redis Client Error', err));

(async () => {
  await redisClient.connect();
})();

interface User {
  username: string;
  password: string;
  email: string;
}

let users: User[] = [];

const initializeUsers = async () => {
  users = [
    {
        username: 'user1', password: await bcrypt.hash('password123', 10),
        email: ''
    },
  ];
};

const typeDefs = gql`
  type Query {
    hello: String
  }

  type Mutation {
    login(username: String!, password: String!): String
    register(username: String!, password: String!, email: String!): String
  }
`;


const resolvers = {
  Mutation: {
    register: async (
      _: unknown,
      { username, password, email }: { username: string; password: string; email: string }
    ) => {
      const hashedPassword = await bcrypt.hash(password, 10);

      // Verificar si el usuario ya existe
      const existingUser = await redisClient.get(`user:${username}`);
      if (existingUser) {
        throw new Error('El usuario ya existe');
      }

      // Almacenar usuario en Redis
      const newUser: User = {
        username,
        password: hashedPassword,
        email,
      };

      await redisClient.set(`user:${username}`, JSON.stringify(newUser));

      return 'Usuario registrado con éxito';
    },

    login: async (_: unknown, { username, password }: { username: string; password: string }) => {
      const userData = await redisClient.get(`user:${username}`);
      if (!userData) throw new Error('Usuario no encontrado');

      const user: User = JSON.parse(userData);

      const valid = await bcrypt.compare(password, user.password);
      if (!valid) throw new Error('Contraseña incorrecta');

      const token = jwt.sign({ username }, SECRET_KEY, { expiresIn: '1h' });
      return token;
    },
  },
};

  

const startServer = async () => {
  await initializeUsers();

  const app: Application = express();
  const server = new ApolloServer({ typeDefs, resolvers });

  await server.start();

  app.use(cors());
  app.use(bodyParser.json());
  app.use('/graphql', expressMiddleware(server));

  const httpsOptions = {
    key: fs.readFileSync('./certificates/private-key.pem'),
    cert: fs.readFileSync('./certificates/certificate.pem'),
  };

  https.createServer(httpsOptions, app).listen(4000, () => {
    console.log('Servidor HTTPS en https://localhost:4000/graphql');
  });
};

startServer().catch((err) => console.error(err));
