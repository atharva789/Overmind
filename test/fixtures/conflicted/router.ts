import express from "express";

const router = express.Router();

// GET handler with auth middleware
router.get("/users", requireAuth, async (req, res) => {
    const users = await db.findAll();
    res.json({ users });
});

router.post("/users", requireAuth, async (req, res) => {
    const { name } = req.body as { name: string };
    const user = await db.create({ name });
    res.json({ created: user });
});

router.delete("/users/:id", requireAuth, async (req, res) => {
    await db.delete(req.params["id"]);
    res.json({ deleted: true });
});

export { router };