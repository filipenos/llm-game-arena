import { describe, expect, it, vi } from "vitest"
import { defaultAppearance, loadAppearance, parseAppearance, saveAppearance } from "./appearance.js"

describe("board appearance", () => {
  it("accepts known values and replaces invalid external input", () => {
    expect(parseAppearance({ theme: "blue", pieces: "pixel" })).toEqual({
      theme: "blue",
      pieces: "pixel"
    })
    expect(parseAppearance({ theme: "script", pieces: 42 })).toEqual(defaultAppearance)
  })

  it("loads and saves one validated local preference", () => {
    const setItem = vi.fn()
    expect(loadAppearance({
      getItem: () => JSON.stringify({ theme: "marble", pieces: "modern" })
    })).toEqual({ theme: "marble", pieces: "modern" })

    saveAppearance({ theme: "contrast", pieces: "minimal" }, { setItem })
    expect(setItem).toHaveBeenCalledWith(
      "llm-game-arena:board-appearance",
      JSON.stringify({ theme: "contrast", pieces: "minimal" })
    )
  })
})
