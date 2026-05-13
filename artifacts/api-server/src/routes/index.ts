import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bucketsRouter from "./buckets";

const router: IRouter = Router();

router.use(healthRouter);
router.use(bucketsRouter);

export default router;
