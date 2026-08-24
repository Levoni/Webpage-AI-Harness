const WebSocket = require("ws");

class HomeAssistantClient {
  constructor({
    url = process.env.HA_URL,
    token = process.env.HA_TOKEN
  } = {}) {
    if (!url) {
      throw new Error("Home Assistant URL is required (HA_URL)");
    }

    if (!token) {
      throw new Error("Home Assistant token is required (HA_TOKEN)");
    }

    this.url = url.replace(/\/+$/, "");
    this.token = token;

    // Convert:
    // http://homeassistant:8123
    // into:
    // ws://homeassistant:8123/api/websocket
    //
    // and:
    // https://homeassistant:8123
    // into:
    // wss://homeassistant:8123/api/websocket
    const websocketUrl = new URL(this.url);

    websocketUrl.protocol =
      websocketUrl.protocol === "https:"
        ? "wss:"
        : "ws:";

    websocketUrl.pathname = "/api/websocket";
    websocketUrl.search = "";
    websocketUrl.hash = "";

    this.websocketUrl = websocketUrl.toString();

    this.ws = null;
    this.wsConnected = false;

    this.messageId = 1;

    this.pendingRequests = new Map();
    this.eventHandlers = new Map();

    this.connectionPromise = null;
  }

  // ---------------------------------------------------------
  // REST API
  // ---------------------------------------------------------

  async request(path, options = {}) {
    const response = await fetch(`${this.url}${path}`, {
      ...options,

      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    });

    const contentType =
      response.headers.get("content-type") || "";

    let data;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const message =
        typeof data === "string"
          ? data
          : data?.message || JSON.stringify(data);

      throw new Error(
        `Home Assistant API error (${response.status}): ${message}`
      );
    }

    return data;
  }

  async getStates() {
    return this.request("/api/states");
  }

  async getState(entityId) {
    if (!entityId) {
      throw new Error("entityId is required");
    }

    return this.request(
      `/api/states/${encodeURIComponent(entityId)}`
    );
  }

  async getServices() {
    return this.request("/api/services");
  }

  async callService(domain, service, data = {}) {
    if (!domain) {
      throw new Error("Service domain is required");
    }

    if (!service) {
      throw new Error("Service name is required");
    }

    return this.request(
      `/api/services/${encodeURIComponent(domain)}/${encodeURIComponent(service)}`,
      {
        method: "POST",
        body: JSON.stringify(data)
      }
    );
  }

  async turnOnLight(entityId, options = {}) {
    return this.callService("light", "turn_on", {
      entity_id: entityId,
      ...options
    });
  }

  async turnOffLight(entityId) {
    return this.callService("light", "turn_off", {
      entity_id: entityId
    });
  }

  /**
   * Turn on multiple lights by entity IDs.
   * @param {string[]} entityIds - Array of light entity IDs.
   * @param {Object} [options] - Options (e.g. brightness).
   */
  async turnOnLights(entityIds, options = {}) {
    return this.callService("light", "turn_on", {
      entity_id: entityIds,
      ...options
    });
  }

  /**
   * Trigger a Home Assistant script.
   *
   * @param {string} scriptId - The script's entity ID (e.g. "script.lights_on") or its name.
   * @param {Object} [options] - Additional service options.
   */
  async triggerScript(scriptId, options = {}) {
    if (!scriptId) {
      throw new Error("Script name is required to trigger a script.");
    }

    const entityId = scriptId.startsWith("script.") ? scriptId : `script.${scriptId}`;

    return this.callService("script", "turn_on", {
      entity_id: entityId,
      ...options
    });
  }

  /**
   * Trigger a Home Assistant scene.
   *
   * @param {string} sceneId - The scene's entity ID (e.g. "scene.movie_night") or its name.
   * @param {Object} [options] - Additional service options.
   */
  async triggerScene(sceneId, options = {}) {
    if (!sceneId) {
      throw new Error("Scene name is required to trigger a scene.");
    }

    const entityId = sceneId.startsWith("scene.") ? sceneId : `scene.${sceneId}`;

    return this.callService("scene", "turn_on", {
      entity_id: entityId,
      ...options
    });
  }

  // ---------------------------------------------------------
  // WEBSOCKET
  // ---------------------------------------------------------

  /**
   * Connect to Home Assistant's WebSocket API.
   */
  async connectWebSocket() {
    if (this.wsConnected) {
      return;
    }

    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    this.connectionPromise = new Promise((resolve, reject) => {
      const ws = new WebSocket(this.websocketUrl);

      this.ws = ws;

      let authenticated = false;

      ws.on("open", () => {
        console.log(
          "Connected to Home Assistant WebSocket"
        );
      });

      ws.on("message", data => {
        try {
          const message = JSON.parse(
            data.toString()
          );

          this.handleWebSocketMessage(
            message,
            resolve,
            reject
          );
        } catch (error) {
          console.error(
            "Error parsing Home Assistant WebSocket message:",
            error
          );
        }
      });

      ws.on("error", error => {
        console.error(
          "Home Assistant WebSocket error:",
          error
        );

        if (!authenticated) {
          this.connectionPromise = null;
          reject(error);
        }
      });

      ws.on("close", () => {
        console.log(
          "Home Assistant WebSocket disconnected"
        );

        this.wsConnected = false;
        this.ws = null;
        this.connectionPromise = null;

        /*
         * Reject outstanding requests.
         */
        for (const [id, pending] of this.pendingRequests) {
          pending.reject(
            new Error(
              "Home Assistant WebSocket disconnected"
            )
          );
        }

        this.pendingRequests.clear();
      });
    });

    return this.connectionPromise;
  }

  /**
   * Handle incoming WebSocket messages.
   */
  handleWebSocketMessage(
    message,
    resolveConnection,
    rejectConnection
  ) {
    /*
     * Home Assistant sends auth_required immediately
     * after connecting.
     */
    if (message.type === "auth_required") {
      this.ws.send(
        JSON.stringify({
          type: "auth",
          access_token: this.token
        })
      );

      return;
    }

    /*
     * Authentication succeeded.
     */
    if (message.type === "auth_ok") {
      this.wsConnected = true;

      console.log(
        "Authenticated with Home Assistant WebSocket"
      );

      if (resolveConnection) {
        resolveConnection();
      }

      return;
    }

    /*
     * Authentication failed.
     */
    if (message.type === "auth_invalid") {
      const error = new Error(
        `Home Assistant WebSocket authentication failed: ${
          message.message || "Unknown error"
        }`
      );

      this.connectionPromise = null;

      if (rejectConnection) {
        rejectConnection(error);
      }

      return;
    }

    /*
     * Handle command responses.
     */
    if (
      message.type === "result" &&
      message.id !== undefined
    ) {
      const pending =
        this.pendingRequests.get(message.id);

      if (!pending) {
        return;
      }

      this.pendingRequests.delete(message.id);

      if (message.success) {
        pending.resolve(message.result);
      } else {
        pending.reject(
          new Error(
            message.error?.message ||
            "Home Assistant WebSocket command failed"
          )
        );
      }

      return;
    }

    /*
     * Handle events.
     */
    if (message.type === "event") {
      this.handleEvent(message);
    }
  }

  /**
   * Handle an incoming HA event.
   */
  handleEvent(message) {
    for (const handler of this.eventHandlers.values()) {
      try {
        handler(message.event, message);
      } catch (error) {
        console.error(
          "Error in Home Assistant event handler:",
          error
        );
      }
    }
  }

  /**
   * Send a command through the WebSocket.
   */
  async sendWebSocketCommand(type, data = {}) {
    await this.connectWebSocket();

    const id = this.messageId++;

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve,
        reject
      });

      this.ws.send(
        JSON.stringify({
          id,
          type,
          ...data
        })
      );
    });
  }

  // ---------------------------------------------------------
  // HOME ASSISTANT REGISTRIES
  // ---------------------------------------------------------

  /**
   * Get the Home Assistant entity registry.
   */
  async getEntityRegistry() {
    return this.sendWebSocketCommand(
      "config/entity_registry/list"
    );
  }

  /**
   * Get the Home Assistant device registry.
   */
  async getDeviceRegistry() {
    return this.sendWebSocketCommand(
      "config/device_registry/list"
    );
  }

  /**
   * Get the Home Assistant area registry.
   */
  async getAreaRegistry() {
    return this.sendWebSocketCommand(
      "config/area_registry/list"
    );
  }

  /**
   * Get a list of entities, optionally filtered by domain.
   * @param {string} [domain] - The domain to filter by.
   * @returns {Promise<Object>} The entity list or filtered list.
   */
  async getEntities(domain) {
    const registry = await this.getEntityRegistry();
    if (!registry || !registry.entities) {
      throw new Error("Entity registry not found or empty.");
    }

    if (domain) {
      return registry.entities.filter(entity => entity.domain === domain);
    }
    return registry.entities;
  }


  /**
   * Subscribe to Home Assistant events.
   *
   * Returns the subscription ID.
  */
  async subscribeToEvents(eventType, handler) {
    const subscriptionId =
      await this.sendWebSocketCommand(
        "subscribe_events",
        {
          event_type: eventType
        }
      );

    this.eventHandlers.set(
      subscriptionId,
      handler
    );

    return subscriptionId;
  }

  /**
   * Subscribe to all state changes.
   */
  async subscribeToStateChanges(handler) {
    return this.subscribeToEvents(
      "state_changed",
      handler
    );
  }

  /**
   * Disconnect the WebSocket.
   */
  disconnectWebSocket() {
    if (this.ws) {
      this.ws.close();
    }

    this.ws = null;
    this.wsConnected = false;
    this.connectionPromise = null;
  }
}

module.exports = HomeAssistantClient;