class EntityStore {
  constructor(homeAssistantClient) {
    if (!homeAssistantClient) {
      throw new Error(
        "HomeAssistantClient is required"
      );
    }

    this.ha = homeAssistantClient;

    this.entities = new Map();
    this.devices = new Map();
    this.areas = new Map();

    this.lastUpdated = null;

    this.initialized = false;
  }

  /**
   * Initialize the entity store.
   *
   * This:
   *
   * 1. Connects to HA WebSocket
   * 2. Gets states
   * 3. Gets entity registry
   * 4. Gets device registry
   * 5. Gets area registry
   * 6. Subscribes to state changes
   */
  async initialize() {
    await this.ha.connectWebSocket();

    await this.refresh();

    await this.ha.subscribeToStateChanges(
      event => {
        this.handleStateChanged(event);
      }
    );

    this.initialized = true;

    console.log(
      `EntityStore initialized with ${this.entities.size} entities`
    );

    return this;
  }

  /**
   * Refresh all Home Assistant information.
   */
  async refresh() {
    const [
      states,
      entityRegistry,
      deviceRegistry,
      areaRegistry
    ] = await Promise.all([
      this.ha.getStates(),
      this.ha.getEntityRegistry(),
      this.ha.getDeviceRegistry(),
      this.ha.getAreaRegistry()
    ]);

    /*
     * Rebuild device registry.
     */
    this.devices.clear();

    for (const device of deviceRegistry) {
      this.devices.set(device.id, {
        id: device.id,

        name: device.name,

        name_by_user:
          device.name_by_user,

        manufacturer:
          device.manufacturer,

        model:
          device.model,

        area_id:
          device.area_id,

        disabled_by:
          device.disabled_by
      });
    }

    /*
     * Rebuild area registry.
     */
    this.areas.clear();

    for (const area of areaRegistry) {
      this.areas.set(area.area_id, {
        area_id: area.area_id,

        name: area.name,

        floor_id:
          area.floor_id
      });
    }

    /*
     * Create an entity registry lookup.
     */
    const entityRegistryMap =
      new Map();

    for (const entity of entityRegistry) {
      entityRegistryMap.set(
        entity.entity_id,
        entity
      );
    }

    /*
     * Rebuild entity store.
     */
    this.entities.clear();

    for (const state of states) {
      const registryEntity =
        entityRegistryMap.get(
          state.entity_id
        );

      const entity =
        this.normalizeEntity(
          state,
          registryEntity
        );

      this.entities.set(
        entity.entity_id,
        entity
      );
    }

    this.lastUpdated = new Date();

    return this.getAll();
  }

  /**
   * Normalize state + registry information.
   */
  normalizeEntity(
    state,
    registryEntity = null
  ) {
    const [domain] =
      state.entity_id.split(".");

    const deviceId =
      registryEntity?.device_id || null;

    const device = deviceId
      ? this.devices.get(deviceId)
      : null;

    /*
     * Entity-level area takes precedence.
     *
     * Otherwise use the device's area.
     */
    const areaId =
      registryEntity?.area_id ||
      device?.area_id ||
      null;

    const area = areaId
      ? this.areas.get(areaId)
      : null;

    return {
      entity_id:
        state.entity_id,

      domain,

      name:
        registryEntity?.name ||
        state.attributes?.friendly_name ||
        state.entity_id,

      state:
        state.state,

      attributes:
        state.attributes || {},

      device: device
        ? {
            id: device.id,

            name:
              device.name_by_user ||
              device.name,

            manufacturer:
              device.manufacturer,

            model:
              device.model
          }
        : null,

      area: area
        ? {
            id: area.area_id,

            name: area.name
          }
        : null,

      device_id:
        deviceId,

      area_id:
        areaId,

      last_changed:
        state.last_changed,

      last_updated:
        state.last_updated
    };
  }

  /**
   * Process a Home Assistant state_changed event.
   */
  handleStateChanged(event) {
    if (!event) {
      return;
    }

    const newState = event.new_state;

    /*
     * Entity was removed.
     */
    if (!newState) {
      if (event.entity_id) {
        this.remove(event.entity_id);
      }

      return;
    }

    const existing =
      this.entities.get(
        event.entity_id
      );

    /*
     * Keep registry information from
     * the existing entity.
     */
    let registryEntity = null;

    if (existing) {
      registryEntity = {
        entity_id:
          existing.entity_id,

        name:
          existing.name,

        device_id:
          existing.device_id,

        area_id:
          existing.area_id
      };
    }

    const entity =
      this.normalizeEntity(
        newState,
        registryEntity
      );

    this.entities.set(
      entity.entity_id,
      entity
    );

    this.lastUpdated =
      new Date();
  }

  /**
   * Get every entity.
   */
  getAll() {
    return Array.from(
      this.entities.values()
    );
  }

  /**
   * Get an entity.
   */
  get(entityId) {
    return this.entities.get(
      entityId
    );
  }

  /**
   * Check if an entity exists.
   */
  has(entityId) {
    return this.entities.has(
      entityId
    );
  }

  /**
   * Get entities by domain.
   */
  getByDomain(domain) {
    return this.getAll().filter(
      entity =>
        entity.domain === domain
    );
  }

  getLights() {
    return this.getByDomain("light");
  }

  getSwitches() {
    return this.getByDomain("switch");
  }

  getSensors() {
    return this.getByDomain("sensor");
  }

  /**
   * Get entities by domain/state.
   */
  getByState(domain, state) {
    return this.getByDomain(domain)
      .filter(
        entity =>
          entity.state === state
      );
  }

  /**
   * Find by friendly name.
   */
  findByName(name) {
    const search =
      name.toLowerCase();

    return this.getAll().filter(
      entity =>
        entity.name
          .toLowerCase()
          .includes(search)
    );
  }

  /**
   * Find by name and optionally domain.
   */
  find(name, domain = null) {
    const search =
      name.toLowerCase();

    return this.getAll().filter(
      entity => {
        const matchesName =
          entity.name
            .toLowerCase()
            .includes(search);

        const matchesDomain =
          !domain ||
          entity.domain === domain;

        return (
          matchesName &&
          matchesDomain
        );
      }
    );
  }

  /**
   * Get entities in an area.
   */
  getByArea(areaName) {
    const search =
      areaName.toLowerCase();

    return this.getAll().filter(
      entity =>
        entity.area?.name
          ?.toLowerCase()
          .includes(search)
    );
  }

  /**
   * Get entities in an area
   * belonging to a domain.
   */
  getByAreaAndDomain(
    areaName,
    domain
  ) {
    return this.getByArea(areaName)
      .filter(
        entity =>
          entity.domain === domain
      );
  }

  /**
   * Get entities belonging to a device.
   */
  getByDevice(deviceId) {
    return this.getAll().filter(
      entity =>
        entity.device_id === deviceId
    );
  }

  /**
   * Get devices.
   */
  getDevices() {
    return Array.from(
      this.devices.values()
    );
  }

  /**
   * Get device.
   */
  getDevice(deviceId) {
    return this.devices.get(
      deviceId
    );
  }

  /**
   * Get areas.
   */
  getAreas() {
    return Array.from(
      this.areas.values()
    );
  }

  /**
   * Get area.
   */
  getArea(areaId) {
    return this.areas.get(
      areaId
    );
  }

  /**
   * Generate compact context for Ollama.
   */
  getLLMContext(options = {}) {
    const {
      domains = null,
      includeAttributes = false
    } = options;

    let entities =
      this.getAll();

    if (domains) {
      entities =
        entities.filter(
          entity =>
            domains.includes(
              entity.domain
            )
        );
    }

    return entities.map(entity => {
      const result = {
        entity_id:
          entity.entity_id,

        domain:
          entity.domain,

        name:
          entity.name,

        state:
          entity.state
      };

      if (entity.area) {
        result.area =
          entity.area.name;
      }

      if (entity.device) {
        result.device = {
          name:
            entity.device.name,

          manufacturer:
            entity.device.manufacturer,

          model:
            entity.device.model
        };
      }

      if (includeAttributes) {
        result.attributes =
          entity.attributes;
      }

      return result;
    });
  }

  /**
   * Store information.
   */
  getInfo() {
    return {
      entities:
        this.entities.size,

      devices:
        this.devices.size,

      areas:
        this.areas.size,

      lastUpdated:
        this.lastUpdated,

      initialized:
        this.initialized
    };
  }

  /**
   * Remove an entity.
   */
  remove(entityId) {
    return this.entities.delete(
      entityId
    );
  }

  /**
   * Clear the store.
   */
  clear() {
    this.entities.clear();
    this.devices.clear();
    this.areas.clear();

    this.lastUpdated = null;
    this.initialized = false;
  }
}

module.exports = EntityStore;