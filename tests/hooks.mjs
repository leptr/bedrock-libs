// Developed by: Petar Mijailovic (leptr)
// GitHub: https://github.com/leptr
// Repo: https://github.com/leptr/bedrock-libs

/** Module resolution hook: sends "@minecraft/server" to the stand-in. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@minecraft/server") {
    return {
      url: new URL("./minecraft_server_stub.mjs", import.meta.url).href,
      shortCircuit: true,
    };
  }
  return nextResolve(specifier, context);
}
