# WILSON

**+ THE ONLY ONE**  
Imagination becomes intelligence.

A calm, layered, iridescent intelligence interface.

## Architecture

```
UI (this React app)
  ↓
Wilson Core          (src/core/wilson)
  ↓
Intelligence Router  (src/intelligence)
  ↓
Model Adapter
  ↓
Model
```

The visual layer (Orb, Field, glass system, home experience) does **not** contain model logic.

## Run

```bash
npm install
npm run dev
```

Open the local URL (usually http://localhost:5173).

## Design direction

- Soft pearl / lavender / pink / cyan atmosphere
- Iridescent, translucent Orb
- Glass surfaces with gentle depth
- Four natural entry points: Imagine · Solve · Reflect · Create
- Mobile-first (designed for iPhone)

## Preserve

Existing core and intelligence contracts in `src/core` and `src/intelligence` remain the foundation. The UI sits on top of them and will be wired to the IntelligenceRouter in a later step.
