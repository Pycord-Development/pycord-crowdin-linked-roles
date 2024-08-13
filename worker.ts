export interface Env {
  CROWDIN_OAUTH_HOST: string;
  CROWDIN_API_HOST: string;
  REDIRECT_URI: string;
  REDIRECT_URI_HANDOVER: string;
  HANDOVER_URI: string;
  CLIENT_ID: string;
  CLIENT_SECRET: string;
  PYCORD_SUPPORT_API_KEY: string;
}

export interface CrowdinUser {
  username: string;
  isAdmin: boolean;
  id: number;
  createdAt: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return await handleRequest(request, env)
  }
} satisfies ExportedHandler<Env>;

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/crowdin/handover-login') {
    return handleLogin(env.REDIRECT_URI_HANDOVER, env)
  } else if (url.pathname === '/crowdin/login') {
    return handleLogin(env.REDIRECT_URI, env)
  } else if (url.pathname === '/crowdin/callback') {
    return handleCallback(url, env)
  } else if (url.pathname === '/crowdin/handover') {
    return handleHandoverCallback(url, env)
  } else {
    return new Response('Not Found', { status: 404 })
  }
}

function handleLogin(uri: string, env: Env): Response {
  const authorizationUrl = `${env.CROWDIN_OAUTH_HOST}/authorize?client_id=${env.CLIENT_ID}&redirect_uri=${encodeURIComponent(uri)}&response_type=code&scope=*`
  return Response.redirect(authorizationUrl, 302)
}

async function handleHandoverCallback(url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get('code');

  if (!code) {
    return new Response('Authorization code not found.', { status: 400 });
  }

  const tokenResponse = await fetch(`${env.CROWDIN_OAUTH_HOST}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      redirect_uri: env.REDIRECT_URI_HANDOVER,
      code: code,
      grant_type: 'authorization_code'
    })
  });

  if (!tokenResponse.ok) {
    return new Response('Failed to fetch access token.', { status: 500 });
  }

  const tokenData: any = await tokenResponse.json();
  const accessToken: string = tokenData.access_token;

  const userInfo = await fetchUserInfo(accessToken, env)
  const userTranslations = await fetchUserTotalTranslations(accessToken, userInfo.id, env)

  const handoverResponse = await fetch(env.HANDOVER_URI, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `AITSYS ${env.PYCORD_SUPPORT_API_KEY}`
    },
    body: JSON.stringify({ "crowdin_user": userInfo, "crowdin_translation_count": userTranslations })
  });

  if (!handoverResponse.ok) {
    return new Response('Failed to hand over data.', { status: 500 });
  }

  return new Response('Data successfully handed over.', { status: 200 });
}


async function handleCallback(url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get('code')

  if (!code) {
    return new Response('Authorization code not found.', { status: 400 })
  }

  const tokenResponse = await fetch(`${env.CROWDIN_OAUTH_HOST}/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      redirect_uri: env.REDIRECT_URI,
      code: code,
      grant_type: 'authorization_code'
    })
  })

  if (!tokenResponse.ok) {
    return new Response('Failed to fetch access token.', { status: 500 })
  }

  const tokenData: any = await tokenResponse.json()
  const accessToken: string = tokenData.access_token

  const userInfo = await fetchUserInfo(accessToken, env)
  const userTranslations = await fetchUserTotalTranslations(accessToken, userInfo.id, env)

  return new Response(`Hi there ${userInfo.username}! You have ${userTranslations} translations. Please make sure you execute '/crowdin-sync' on the server with the Pycord Support application`, { status: 200 })
}

async function fetchUserInfo(accessToken: string, env: Env): Promise<CrowdinUser> {
  const query = `
      query GetUserInfo {
        viewer {
          username
          isAdmin
          id
          createdAt
        }
      }
    `
  const response: any = await fetchCrowdinApi(query, accessToken, env)
  return response.viewer as CrowdinUser
}

async function fetchUserTotalTranslations(accessToken: string, userId: number, env: Env): Promise<number> {
  const query = `
      query GetUserTotalTranslations {
        viewer {
          projects(first: 1) {
            edges {
              node {
                id
                identifier
                description
                nodeId
                name
                translations(userId: ${userId}, first: 10) {
                  totalCount
                }
              }
            }
          }
        }
      }
    `
  const response = await fetchCrowdinApi(query, accessToken, env)
  return response.viewer.projects.edges[0].node.translations.totalCount as number
}

async function fetchCrowdinApi(query: string, accessToken: string, env: Env): Promise<any> {
  const response = await fetch(env.CROWDIN_API_HOST, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify({ query })
  })

  const responseData: any = await response.json()
  if (responseData.errors) {
    throw new Error(responseData.errors[0].message)
  }
  return responseData.data
}
