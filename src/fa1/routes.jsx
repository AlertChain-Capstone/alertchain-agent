import Fa1App from './Fa1App.jsx'

export default {
  Component: Fa1App,
  routes: [
    { path: '/sources', view: 'sources' },
    { path: '/alerts', view: 'alerts' },
    { path: '/alerts/:id', view: 'detail' },
  ],
}
