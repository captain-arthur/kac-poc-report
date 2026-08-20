import http from 'k6/http';
import encoding from 'k6/encoding';
import chai, { describe, expect } from 'https://jslib.k6.io/k6chaijs/4.5.0.1/index.js';
import yaml from 'https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/dist/js-yaml.mjs';

chai.config.aggregateChecks = false;

const USER = 'kac-can-i';
const CLUSTER_ADMIN = 't-rbac-kac-cluster-admin';
const NS_VIEWER = 't-rbac-kac-ns-viewer';
const NAMESPACE = 'rbac-test';

const kubeconfig = yaml.load(open(__ENV.KUBECONFIG || `${__ENV.HOME}/.kube/config`));
const context = kubeconfig.contexts.find((c) => c.name === kubeconfig['current-context']).context;
const cluster = kubeconfig.clusters.find((c) => c.name === context.cluster).cluster;
const user = kubeconfig.users.find((u) => u.name === context.user).user;
const headers = { Accept: 'application/json' };
if (user.token) headers.Authorization = `Bearer ${user.token}`;
const kube = {
  server: cluster.server.replace(/\/$/, ''),
  cert: user['client-certificate-data'] ? encoding.b64decode(user['client-certificate-data'], 'std', 's') : undefined,
  key: user['client-key-data'] ? encoding.b64decode(user['client-key-data'], 'std', 's') : undefined,
  headers,
};

export const options = {
  vus: 1,
  iterations: 1,
  insecureSkipTLSVerify: true,
  tlsAuth: kube.cert ? [{ cert: kube.cert, key: kube.key }] : [],
};

export default function () {
  const catalog = discover();

  describe(`as group ${CLUSTER_ADMIN} in namespace ${NAMESPACE}`, () => {
    const actual = canI(catalog, CLUSTER_ADMIN, NAMESPACE);

    describe('Then', () => {
      expect(actual[`can-i get pods -n ${NAMESPACE}`]).to.equal(`can-i get pods -n ${NAMESPACE} = yes`);
      expect(actual[`can-i create pods -n ${NAMESPACE}`]).to.equal(`can-i create pods -n ${NAMESPACE} = yes`);
      expect(actual[`can-i delete pods -n ${NAMESPACE}`]).to.equal(`can-i delete pods -n ${NAMESPACE} = no`);
      expect(actual[`can-i create pods --subresource=exec -n ${NAMESPACE}`]).to.equal(
        `can-i create pods --subresource=exec -n ${NAMESPACE} = yes`,
      );
    });
  });

  describe(`as group ${NS_VIEWER} in namespace ${NAMESPACE}`, () => {
    const actual = canI(catalog, NS_VIEWER, NAMESPACE);

    describe('Then', () => {
      expect(actual[`can-i get pods -n ${NAMESPACE}`]).to.equal(`can-i get pods -n ${NAMESPACE} = yes`);
      expect(actual[`can-i create pods -n ${NAMESPACE}`]).to.equal(`can-i create pods -n ${NAMESPACE} = no`);
      expect(actual[`can-i create pods --subresource=exec -n ${NAMESPACE}`]).to.equal(
        `can-i create pods --subresource=exec -n ${NAMESPACE} = no`,
      );
    });
  });
}

function discover() {
  function get(path) {
    const res = http.get(kube.server + path, { timeout: '30s', headers: kube.headers });
    if (res.status !== 200) throw new Error(`GET ${path} -> ${res.status}`);
    return res.json();
  }

  function items(group, list) {
    const result = [];
    for (const item of list.resources) {
      const [resource, subresource = ''] = item.name.split('/');
      result.push({
        group,
        resource,
        subresource,
        namespaced: item.namespaced,
        verbs: item.verbs,
      });
    }
    return result;
  }

  const core = get('/api/v1');
  const groups = get('/apis').groups;
  const groupCatalog = [];
  for (const group of groups) {
    const resources = get(`/apis/${group.preferredVersion.groupVersion}`);
    groupCatalog.push({
      group: group.name,
      resources: items(group.name, resources),
    });
  }

  const coreCatalog = items('', core);
  return { core: coreCatalog, groups: groupCatalog };
}

function canI(catalog, asGroup, namespace) {
  const actual = { 'can-i': '' };
  console.log(`as group ${asGroup} -n ${namespace}`);

  function check(item) {
    const type = item.group ? `${item.resource}.${item.group}` : item.resource;

    for (const verb of item.verbs) {
      const review = {
        apiVersion: 'authorization.k8s.io/v1',
        kind: 'SubjectAccessReview',
        spec: {
          user: USER,
          groups: [asGroup],
          resourceAttributes: {
            group: item.group,
            resource: item.resource,
            subresource: item.subresource,
            verb,
            namespace: item.namespaced ? namespace : '',
          },
        },
      };

      const res = http.post(
        kube.server + '/apis/authorization.k8s.io/v1/subjectaccessreviews',
        JSON.stringify(review),
        {
          timeout: '30s',
          headers: Object.assign({ 'Content-Type': 'application/json' }, kube.headers),
        },
      );
      if (res.status !== 200 && res.status !== 201) {
        throw new Error(`POST subjectaccessreviews ${verb} ${type} -> ${res.status}`);
      }

      const status = res.json().status;
      const allowed = status && status.allowed ? 'yes' : 'no';
      let question = `can-i ${verb} ${type}`;
      if (item.subresource) question += ` --subresource=${item.subresource}`;
      if (item.namespaced) question += ` -n ${namespace}`;
      const line = `${question} = ${allowed}`;
      actual[question] = line;
      actual['can-i'] += `${line}\n`;
      console.log(`${question} --as=${USER} --as-group=${asGroup} = ${allowed}`);
    }
  }

  for (const item of catalog.core) check(item);
  for (const group of catalog.groups) {
    for (const item of group.resources) check(item);
  }
  return actual;
}
