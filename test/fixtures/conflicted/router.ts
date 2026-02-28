import express from "express";

const router = express.Router();

// Simple GET handler, no middleware
router.get("/users", (req, res) => {
    res.json({ users: [] });
});

router.post("/users", (req, res) => {
    const { name } = req.body as { name: string };
    res.json({ created: name });
});

export default router;
