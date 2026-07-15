# Story Manager

Your chats pile up fast, and after a while it's a wall of nameless entries you can't tell apart. Story Manager gives them a shelf to live on.

It's an archival librarian for your roleplay: organize chats into **Storylines**, group storylines into **Books**, and browse the whole thing as a proper library instead of a flat list. It reads your existing chats and characters and works completely standalone.

Enjoy :) -moki

---

## The Structure

Three layers, nested:

- **Book** — A collection. Think of it as a series, a shared world, or just a shelf you made up. Holds storylines.
- **Storyline** — A single thread tied to a character and persona(s). Holds chats.
- **Chat** — Your actual ST chats. Each one belongs to at most one storyline, so there's no confusion about where something lives.

Books hold storylines, storylines hold chats. Assign a chat once and it stays put until you move it (you'll get a warning before a move so you don't reassign something by accident).

## The Surfaces

Story Manager opens three different ways depending on what you're doing:

- **Display** — The gallery view. This is the default entry point: cover images, book and storyline cards, the whole library laid out to browse. Open it from the wand menu or `/storymanager`.
- **Modal** — The management panel for creating, editing, and reorganizing books and storylines. Open with `/storymanager-modal`.
- **Sidebar** — A quick in-chat panel for assigning the current chat to a storyline without leaving the scene. Open with `/storymanager-sidebar`.

## Books & Storylines

Both books and storylines carry a **title**, a **description**, **cover art**, and **tags**. Storylines also track their character, main personas, and a hero image.

**Generated descriptions** — Don't feel like writing a blurb? Story Manager can generate a description for a book or storyline for you using a connection profile of your choosing.

**Tags** — Freeform tags plus your existing SillyTavern tags, so you can filter and sort the library however you think about it.

**Timespans** — Books can carry a timespan (auto-derived from their chats, or a custom label) for when you want a sense of chronology across a series.

## Settings

In the Extensions drawer under Story Manager.

- **Entry Point** — Whether the wand button opens straight to the Display gallery (default) or the management Modal.
- **Connection Profile** — Which API connection/preset to use for generated descriptions. Run a cheap model here since blurbs don't need your best one.
- **Generation Length** — Target length for generated descriptions (short, medium, long).
- **Warn on Chat Move** — Toggle the confirmation prompt when reassigning a chat that already belongs to a storyline.

## Works With

All optional, all feature-detected. Story Manager runs fine without any of them.

- **SimpleSummarizer** — Pulls in your chat summaries where they're useful.
- **UIBedazzler** — If you have the side-button strip active, Story Manager adds itself there and hides its wand entries automatically, so you don't get duplicate buttons.

## Installation

Use SillyTavern's built-in extension installer:

1. Open **Extensions** → **Install Extension**
2. Paste this URL:
   ```
   https://github.com/mokimoko/SillyTavern-StoryManager
   ```
3. Click **Install** and reload if prompted

## Slash Commands

- `/storymanager` — Open the Display gallery
- `/storymanager-modal` — Open the management modal
- `/storymanager-sidebar` — Open the in-chat sidebar
