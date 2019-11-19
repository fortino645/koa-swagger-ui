const pathToRegex = require('path-to-regexp');
const j2s = require('joi-to-swagger');
const each = require('lodash/each');
const pick = require('lodash/pick');
const get = require('lodash/get');
const mapValues = require('lodash/mapValues');
const some = require('lodash/some');

const captureRegex = /(:\w+)/g;

const JSON_SCHEMA_FIELDS = [
  'type', 'required',

  'maximum', 'exclusiveMaximum', 'minimum', 'exclusiveMinimum',
  'maxLength', 'minLength', /* 'pattern', */ 'maxItems', 'minItems',
  'uniqueItems', 'enum', 'multipleOf'
];

exports.mergeSwaggerPaths = function mergeSwaggerPaths(paths, newPaths, options) {
  const warn = options && options.warnFunc;

  each(newPaths, (newPathItemObj, path) => {
    const pathItemObj = paths[path] = paths[path] || {};

    // Merge operations into path
    each(newPathItemObj, (operationObj, method) => {
      if (pathItemObj[method]) {
        // already exists!
        if (warn) warn(`${path}[${method}] exists in multiple routes`);
        return;
      }

      pathItemObj[method] = operationObj;
    });
  });

  return paths;
};

exports.routesToSwaggerPaths = function routesToSwaggerPaths(routes, options) {
  const paths = {};

  routes.forEach((route) => {
    const routePaths = exports.routeToSwaggerPaths(route, options);

    exports.mergeSwaggerPaths(paths, routePaths, options);
  });

  return paths;
};

/**
 * For a given joi-router route, return an array of Swagger paths.
 * @param {object} route
 * @returns {object[]} paths
 */
exports.routeToSwaggerPaths = function routeToSwaggerPaths(route, options) {
  options = options || {};

  const paths = {};
  const routeDesc = {
    responses: {
      200: {
        description: 'Success'
      }
    }
  };

  if (route.validate) {
    const type = route.validate.type;

    if (!type) {
      // do nothing
    } else if (type === 'json') {
      routeDesc.consumes = ['application/json'];
    } else if (type === 'form') {
      routeDesc.consumes = ['application/x-www-form-urlencoded'];
    } else if (type === 'multipart') {
      routeDesc.consumes = ['multipart/form-data'];
    }
    // else if (type === 'form' || type === 'multipart') {
    //   throw new Error(`${type} type not supported`);
    // }

    routeDesc.parameters = exports.validateToSwaggerParameters(route.validate);
  }

  if (route.swagger) {
    Object.assign(routeDesc, route.swagger);
  }

  if (routeDesc.responses) {
    Object.keys(routeDesc.responses).forEach((x) => {
      if (routeDesc.responses[x].schema) {
        routeDesc.responses[x].schema = j2s(routeDesc.responses[x].schema).swagger;
      }
    });
  }

  // This sets default 'path' parameters so swagger-ui doesn't complain.
  const noPathParamsExist = !some(routeDesc.parameters, ['in', 'path']);
  const noPathValidatorExists = get(route, 'validate.path') === undefined;
  if (noPathParamsExist && noPathValidatorExists) {
    routeDesc.parameters = routeDesc.parameters || [];
    const pathCaptures = route.path.match(captureRegex);
    if (pathCaptures) {
      each(pathCaptures, (pathParameter) => {
        routeDesc.parameters.push({
          name: pathParameter.replace(':', ''),
          in: 'path',
          type: 'string',
          required: true
        });
      });
    }
  }
  routeDesc.parameters.sort((x, y) => (x.name > y.name ? 1 : -1));

  let path = exports.swaggerizePath(route.path);

  if (options.prefix) {
    if (options.prefix.endsWith('/') || path.startsWith('/')) {
      path = `${options.prefix}${path}`;
    } else {
      path = `${options.prefix}/${path}`;
    }
  }

  const pathItemObj = paths[path] = {};

  const methods = Array.isArray(route.method) ? route.method : [route.method];

  methods.forEach((method) => {
    const operationObj = routeDesc;
    pathItemObj[method.toLowerCase()] = operationObj;
  });

  return paths;
};

function addSchemaParameters(parameters, location, schema) {
  const swaggerObject = j2s(schema).swagger;
  if (swaggerObject.type === 'object' && swaggerObject.properties) {
    const required = (swaggerObject.required || []).concat('Signature');
    each(swaggerObject.properties, (value, name) => {
      const parameter = value;
      parameter.name = name;
      parameter.in = location;
      if (required.indexOf(name) !== -1) {
        parameter.required = true;
      }
      parameters.push(parameter);
    });
  }
}

/**
 * Convert a JSON schema object to the subset used by Swagger
 */
exports.jsonSchemaToSwagger = function (jsonSchema) {
  if (Array.isArray(jsonSchema)) {
    return jsonSchema.map(exports.jsonSchemaToSwagger);
  }

  const schema = pick(jsonSchema, JSON_SCHEMA_FIELDS);

  if (jsonSchema.items) {
    // FIXME HACK
    if (Array.isArray(jsonSchema.items)) {
      jsonSchema.items = jsonSchema.items[0];
    }

    schema.items = exports.jsonSchemaToSwagger(jsonSchema.items);
  }

  if (jsonSchema.properties) {
    schema.properties = mapValues(jsonSchema.properties, value => exports.jsonSchemaToSwagger(value));
  }

  return schema;
};

/**
 * Convert joi-router validate object to swagger
 */
exports.validateToSwaggerParameters = function (validate) {
  const parameters = [];

  if (validate.header) {
    addSchemaParameters(parameters, 'header', validate.header);
  }

  if (validate.query) {
    addSchemaParameters(parameters, 'query', validate.query);
  }

  if (validate.path) {
    // TODO: Write about in README.md
    addSchemaParameters(parameters, 'path', validate.path);
  }

  if (validate.body) {
    if (validate.type === 'json') {
      const swaggerSchema = j2s(validate.body).swagger;
      parameters.push({
        name: 'body',
        in: 'body',
        schema: swaggerSchema
      });
    } else {
      addSchemaParameters(parameters, 'formData', validate.body);
    }
  }
  return parameters;
};

/* Convert a joi-router path into a Swagger parameterized path,
 * e.g. /users/:userId becomes /users/{userId}
 *
 * FIXME: incomplete handling, escaping, etc
 * FIXME: throw error if a complex regex is used
 */
exports.swaggerizePath = function swaggerizePath(path) {
  const pathTokens = pathToRegex.parse(path);

  const segments = pathTokens.map((token) => {
    let segment = token;

    if (token.name) {
      segment = `{${token.name}}`; // this means this is a complex regex group. for more info, read up on path-to-regexp, koa-joi-router uses it, it's great.
    } else {
      segment = token.replace('/', ''); // remove leading slash, to handle things like complex routes: /users/:userId/friends/:friendId
    }

    return segment;
  });

  return `/${segments.join('/')}`; // path is normalized, just add that leading slash back to handle prefixes properly again.
};
