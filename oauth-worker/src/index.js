export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/auth") {
      const callback = `${url.origin}/callback`;
      const github = new URL("https://github.com/login/oauth/authorize");
      github.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
      github.searchParams.set("redirect_uri", callback);
      github.searchParams.set("scope", "repo");
      return Response.redirect(github.toString(), 302);
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("Missing code", { status: 400 });

      const tokenResp = await fetch("https://github.com/login/oauth/access_token", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code
        })
      });

      const data = await tokenResp.json();
      if (!data.access_token) {
        return new Response(JSON.stringify(data), { status: 400, headers: {"content-type":"application/json"} });
      }

      const payload = {
        token: data.access_token,
        provider: "github"
      };

      const html = `<!doctype html><html><body><script>
        const receiveMessage = ${JSON.stringify(payload)};
        window.opener.postMessage(
          'authorization:github:success:' + JSON.stringify(receiveMessage),
          '*'
        );
        window.close();
      <\/script></body></html>`;

      return new Response(html, { headers: {"content-type":"text/html;charset=UTF-8"} });
    }

    return new Response("Not Found", { status: 404 });
  }
};
