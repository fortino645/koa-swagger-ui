const assert = require('assert');
const cloneDeep = require('lodash/cloneDeep');
const generator = require('./generator');

class SwaggerAPI {
  constructor() {
    this.apiRoutes = [];
  }

  /**
   * Add a `koa-joi-router` router to the API.
   * @param {Router} router - koa-joi-router instance
   * @param {object} options
   * @param {string} [options.prefix]
   */
  addJoiRouter(router, options) {
    options = options || {};

    if (typeof options === 'string') {
      options = { prefix: options };
    }

    if (!Array.isArray(router.routes)) {
      throw new TypeError('router does not have exposed .routes array'
                          + ' (not a joi-router instance)');
    }

    router.routes.forEach((route) => {
      const { swagger: { hide = false } = {} } = route;
      if (!hide) {
        this.apiRoutes.push({
          route,
          prefix: router.router.opts.prefix || options.prefix
        });
      }
    }, this);
  }

  /**
   * Generate a Swagger 2.0 specification as an object for this API.
   *
   * @param {object} baseSpec - base document
   * @param {object} baseSpec.info
   * @param {string} baseSpec.info.title
   * @param {string} baseSpec.info.version
   * @param {object} [options]
   * @returns {object} swagger 2.0 specification
   */
  generateSpec(baseSpec, options) {
    options = { warnFunc: console.warn, ...options };

    assert(baseSpec.info, 'baseSpec.info parameter missing');
    assert(baseSpec.info.title, 'baseSpec.info.title parameter missing');
    assert(baseSpec.info.version, 'baseSpec.info.version parameter missing');

    const doc = cloneDeep(baseSpec);
    doc.swagger = '2.0';
    doc.paths = doc.paths || {};

    this.apiRoutes.forEach((apiRoute) => {
      const routeOptions = { ...options, prefix: apiRoute.prefix };
      const routePaths = generator.routeToSwaggerPaths(apiRoute.route,
        routeOptions);

      generator.mergeSwaggerPaths(doc.paths, routePaths, options);
    }, this);

    return doc;
  }
}

module.exports = SwaggerAPI;
