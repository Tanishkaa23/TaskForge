import { Queue } from "bullmq";
import redisConn from "../config/redis.js";

const taskQueue = new Queue("task-queue",{
    connection : redisConn
})

export default taskQueue